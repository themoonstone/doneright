import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Bbox } from './types.js';

export async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Deterministic JSON: object keys sorted, no whitespace. Used for contract hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function contractHash(contract: unknown): string {
  return sha256Text(canonicalJson(contract));
}

/** Stable issue id: same rule + page + quantized box always maps to the same id. */
export function issueId(ruleId: string, page: number | null, bbox?: Bbox): string {
  const q = bbox
    ? [bbox.x, bbox.y, bbox.w, bbox.h].map((n) => (Math.round(n * 1000) / 1000).toFixed(3)).join(',')
    : '-';
  return `iss_${sha256Text(`${ruleId}|${page ?? 0}|${q}`).slice(0, 12)}`;
}

export function reportId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `rpt_${stamp}_${randomBytes(3).toString('hex')}`;
}
