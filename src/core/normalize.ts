import type { TextRun } from '../engine/types.js';

/** Group runs into visual lines, then into plain text. Order: top-to-bottom, left-to-right. */
export function assemblePageText(runs: TextRun[]): { lines: string[]; text: string } {
  const usable = runs.filter((r) => r.str.length > 0 && r.rect.w >= 0 && r.rect.h > 0);
  const sorted = [...usable].sort((a, b) => {
    const ay = a.rect.y + a.rect.h / 2;
    const by = b.rect.y + b.rect.h / 2;
    if (Math.abs(ay - by) > 1) return ay - by;
    return a.rect.x - b.rect.x;
  });

  const lines: Array<{ cy: number; size: number; runs: TextRun[] }> = [];
  for (const run of sorted) {
    const cy = run.rect.y + run.rect.h / 2;
    const last = lines[lines.length - 1];
    const tolerance = Math.max(2, 0.5 * Math.max(run.fontSize, last?.size ?? 0));
    if (last && Math.abs(cy - last.cy) <= tolerance) {
      last.runs.push(run);
      last.cy = (last.cy + cy) / 2;
      last.size = Math.max(last.size, run.fontSize);
    } else {
      lines.push({ cy, size: run.fontSize, runs: [run] });
    }
  }

  const out: string[] = [];
  for (const line of lines) {
    const parts = [...line.runs].sort((a, b) => a.rect.x - b.rect.x);
    let text = '';
    let prev: TextRun | undefined;
    for (const run of parts) {
      if (prev) {
        const gap = run.rect.x - (prev.rect.x + prev.rect.w);
        const threshold = 0.2 * Math.max(prev.fontSize, 1);
        const needsSpace =
          gap > threshold &&
          !/\s$/.test(text) &&
          !/^\s/.test(run.str) &&
          // CJK does not need a synthetic space between glyph runs
          !(isCjk(lastChar(text)) && isCjk(run.str[0] ?? ''));
        if (needsSpace) text += ' ';
      }
      text += run.str;
      prev = run;
    }
    out.push(text.trimEnd());
  }

  const joined = dehyphenateLines(out).join('\n');
  return { lines: out, text: joined };
}

function lastChar(s: string): string {
  return s.length ? s[s.length - 1]! : '';
}

function isCjk(ch: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

/** "exam-\nple" -> "example" for Latin words split across lines. */
function dehyphenateLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(line)) {
      out[out.length - 1] = `${prev.slice(0, -1)}${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Matching normalization, in this order: NFKC, unify quotes/dashes, drop
 * zero-width chars, collapse whitespace, remove spaces between CJK, lowercase.
 */
export function normalizeText(input: string, caseSensitive = false): string {
  let s = input.normalize('NFKC');
  s = s
    .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ');
  s = s.replace(
    /(?<=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]) (?=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g,
    '',
  );
  s = s.trim();
  return caseSensitive ? s : s.toLowerCase();
}

/** Remove repeated first/last lines (running headers/footers) across pages. */
export function stripRunningHeaders(
  pages: string[],
  options: { minPages?: number; ratio?: number } = {},
): { pages: string[]; removed: string[] } {
  const minPages = options.minPages ?? 3;
  const ratio = options.ratio ?? 0.6;
  if (pages.length < minPages) return { pages, removed: [] };

  const candidates = new Map<string, number>();
  for (const page of pages) {
    const lines = page.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const edges = new Set([lines[0]!, lines[lines.length - 1]!]);
    for (const line of edges) {
      if (line.length <= 80) candidates.set(line, (candidates.get(line) ?? 0) + 1);
    }
  }
  const repeated = new Set(
    [...candidates.entries()].filter(([, n]) => n >= minPages && n / pages.length >= ratio).map(([l]) => l),
  );
  if (repeated.size === 0) return { pages, removed: [] };

  const removed = new Set<string>();
  const out = pages.map((page) => {
    const lines = page.split('\n');
    const kept = lines.filter((line, i) => {
      const isEdge = i === 0 || i === lines.length - 1;
      if (isEdge && repeated.has(line.trim())) {
        removed.add(line.trim());
        return false;
      }
      return true;
    });
    return kept.join('\n');
  });
  return { pages: out, removed: [...removed] };
}
