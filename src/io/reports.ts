import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderMarkdown } from '../core/render.js';
import type { HistoryEntry, Report } from '../core/types.js';

export interface WrittenReport {
  jsonPath: string;
  markdownPath: string;
  dir: string;
}

export async function writeReport(report: Report, outDir: string): Promise<WrittenReport> {
  const dir = join(outDir, 'reports', report.reportId);
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, 'report.json');
  const markdownPath = join(dir, 'report.md');
  await atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(markdownPath, `${renderMarkdown(report)}\n`);
  return { jsonPath, markdownPath, dir };
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

export function historyPath(outDir: string): string {
  return join(outDir, 'history.jsonl');
}

export async function appendHistory(outDir: string, entry: HistoryEntry): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await appendFile(historyPath(outDir), `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function readHistory(outDir: string): Promise<HistoryEntry[]> {
  let text: string;
  try {
    text = await readFile(historyPath(outDir), 'utf8');
  } catch {
    return [];
  }
  const out: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as HistoryEntry;
      if (parsed && typeof parsed.reportId === 'string') out.push(parsed);
    } catch {
      // A torn or hand-edited line must not break verification.
    }
  }
  return out;
}

/** Newest-first history entries that share the artifact and contract identity. */
export function historyFor(history: HistoryEntry[], artifactSha256: string, contractHash: string, limit = 5): HistoryEntry[] {
  return history
    .filter((h) => h.artifactSha256 === artifactSha256 && h.contractHash === contractHash)
    .slice(-limit)
    .reverse();
}

export async function readReport(path: string): Promise<Report> {
  const text = await readFile(path, 'utf8');
  const report = JSON.parse(text) as Report;
  if (!report || typeof report.reportId !== 'string' || !Array.isArray(report.issues)) {
    throw new Error(`${path} is not a DoneRight report`);
  }
  return report;
}

export function reportDirOf(artifactPath: string): string {
  return join(dirname(artifactPath), '.doneright');
}
