/** Bounded Levenshtein and fuzzy location helpers used by content checks. */

export function levenshtein(a: string, b: string, max = 64): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  const dist = levenshtein(a.slice(0, 400), b.slice(0, 400), Math.ceil(longest * 0.5));
  return Math.max(0, 1 - dist / longest);
}

export interface FuzzyHit {
  score: number;
  snippet: string;
}

/**
 * Find the best matching sentence-ish chunk. Used only for long requirements
 * (> 40 chars), where exact substring matching is too brittle across line
 * wrapping and PDF extraction quirks.
 */
export function bestChunkMatch(needle: string, haystack: string): FuzzyHit {
  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    return { score: 1, snippet: haystack.slice(Math.max(0, exact - 20), exact + needle.length + 20) };
  }
  const chunks = haystack
    .split(/(?<=[.!?。！？;；])\s+|\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= Math.min(12, needle.length));
  let best: FuzzyHit = { score: 0, snippet: '' };
  for (const chunk of chunks) {
    if (Math.abs(chunk.length - needle.length) > Math.max(40, needle.length * 0.6)) continue;
    const score = similarity(needle, chunk);
    if (score > best.score) best = { score, snippet: chunk.slice(0, 160) };
  }
  return best;
}
