#!/usr/bin/env node
import { resolve } from 'node:path';
import { verify } from './verification/run.js';
import { renderMarkdown } from './core/render.js';

interface Args {
  command: string;
  artifact?: string;
  contract?: string;
  out?: string;
  previous?: string;
  strict: boolean;
  json: boolean;
  write: boolean;
}

const USAGE = `Usage: doneright check <artifact.pdf> [options]

Options:
  --contract <file>   Acceptance contract JSON
  --out <dir>         Report directory (default: <cwd>/.doneright)
  --previous <file>   Previous report.json to diff against
  --strict            Require headings to start a line
  --json              Print the full report JSON
  --no-write          Do not write report files
  -h, --help          Show this help

Exit codes: 0 PASS, 1 FAIL, 2 REVIEW, 3 ERROR, 4 usage/runtime error.`;

async function main(argv: string[]): Promise<number> {
  const args = parse(argv);
  if (args.command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.command !== 'check' || !args.artifact) {
    process.stderr.write(`${USAGE}\n`);
    return 4;
  }

  try {
    const result = await verify({
      artifactPath: resolve(args.artifact),
      ...(args.contract ? { contractPath: resolve(args.contract) } : {}),
      outDir: resolve(args.out ?? '.doneright'),
      ...(args.previous ? { previousReport: resolve(args.previous) } : {}),
      ...(args.strict ? { strictHeadings: true } : {}),
      writeReports: args.write,
    });
    const { report } = result;
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderMarkdown(report)}\n`);
    }
    if (!args.json) {
      if (result.reportMarkdownPath) process.stdout.write(`\nMarkdown: ${result.reportMarkdownPath}\n`);
      if (result.reportJsonPath) process.stdout.write(`JSON:     ${result.reportJsonPath}\n`);
    }
    return report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : report.status === 'REVIEW' ? 2 : 3;
  } catch (error) {
    process.stderr.write(`doneright: ${(error as Error).message}\n`);
    return 4;
  }
}

function parse(argv: string[]): Args {
  const out: Args = { command: argv[0] ?? 'help', strict: false, json: false, write: true };
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--contract') out.contract = argv[++i];
    else if (token === '--out') out.out = argv[++i];
    else if (token === '--previous') out.previous = argv[++i];
    else if (token === '--strict') out.strict = true;
    else if (token === '--json') out.json = true;
    else if (token === '--no-write') out.write = false;
    else if (!token.startsWith('-')) positional.push(token);
  }
  out.artifact = positional[0];
  return out;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
