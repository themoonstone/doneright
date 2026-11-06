import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Fixture {
  dir: string;
  path: string;
}

export async function makePdf(
  name: string,
  draw: (page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont) => void,
  options: { width?: number; height?: number; pages?: number } = {},
): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const count = options.pages ?? 1;
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([options.width ?? 595, options.height ?? 842]);
    draw(page, font);
  }
  const dir = await mkdtemp(join(tmpdir(), 'doneright-test-'));
  const path = join(dir, `${name}.pdf`);
  await writeFile(path, await doc.save());
  return { dir, path };
}

export const CONTRACT = (requirements: unknown[]) => ({
  schemaVersion: '1.0',
  contractId: 'test',
  requirements,
  options: { stripRunningHeaders: false },
});

export async function writeContract(dir: string, contract: unknown): Promise<string> {
  const path = join(dir, 'contract.json');
  await writeFile(path, JSON.stringify(contract, null, 2), 'utf8');
  return path;
}

export function drawText(
  page: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  text: string,
  x: number,
  y: number,
  size = 12,
): void {
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
}
