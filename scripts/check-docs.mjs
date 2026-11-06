// Doc consistency checks: relative links resolve, ```json blocks parse, table rows align.
// Usage: node scripts/check-docs.mjs [root]
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const docsDir = resolve(root, 'docs');
const files = [
  'README.md',
  ...(existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort().map((f) => `docs/${f}`)
    : []),
];
const errors = [];

for (const rel of files) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    errors.push(`${rel}: missing file`);
    continue;
  }
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  // 1. relative links
  const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of text.matchAll(linkRe)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = decodeURI(target.split('#')[0]);
    if (!clean) continue;
    const p = resolve(dirname(abs), clean);
    if (!existsSync(p)) errors.push(`${rel}: broken link -> ${target}`);
    else if (target.endsWith('/') && !statSync(p).isDirectory()) errors.push(`${rel}: not a directory -> ${target}`);
  }

  // 2. json code blocks
  const jsonRe = /```json\n([\s\S]*?)```/g;
  let n = 0;
  for (const m of text.matchAll(jsonRe)) {
    n++;
    try {
      JSON.parse(m[1]);
    } catch (e) {
      errors.push(`${rel}: json block #${n} invalid: ${e.message}`);
    }
  }

  // 3. table column consistency
  let block = [];
  const flush = () => {
    if (block.length >= 2) {
      const counts = block.map((b) => b.text.split(/(?<!\\)\|/).length);
      const expected = counts[0];
      counts.forEach((c, i) => {
        if (c !== expected) errors.push(`${rel}:${block[i].line}: table has ${c - 1} cells, header has ${expected - 1}`);
      });
    }
    block = [];
  };
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('|')) block.push({ text: line, line: i + 1 });
    else flush();
  });
  flush();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`docs ok: ${files.join(', ')}`);
