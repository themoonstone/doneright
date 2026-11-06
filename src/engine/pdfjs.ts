import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getDocument, version as pdfjsVersion, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OpenedDocument, PageInfo, Rect, TextRun } from './types.js';
import { isOpenError, makeOpenError } from './errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Locate the installed pdfjs-dist package whatever the node_modules layout is. */
function pdfjsPackageRoot(): string | undefined {
  const probes: Array<{ spec: string; up: number }> = [
    { spec: 'pdfjs-dist/package.json', up: 0 },
    { spec: 'pdfjs-dist/legacy/build/pdf.mjs', up: 2 },
  ];
  for (const probe of probes) {
    try {
      let root = dirname(require.resolve(probe.spec));
      for (let i = 0; i < probe.up; i++) root = dirname(root);
      if (existsSync(`${root}/cmaps`)) return root;
    } catch {
      // Try the next probe; a bundler may restrict package.json exports.
    }
  }
  return undefined;
}

/**
 * pdfjs resolves cmaps/standard fonts relative to the package. Prefer assets
 * copied next to the build; otherwise ask Node where pdfjs-dist actually lives.
 */
function assetRoot(): string {
  const local = resolve(HERE, '..', 'assets');
  if (existsSync(`${local}/cmaps`)) return local;
  return pdfjsPackageRoot() ?? local;
}

const CMAP_DIR = `${assetRoot()}/cmaps/`;
const STANDARD_FONTS = `${assetRoot()}/standard_fonts/`;

interface OpenOptions {
  maxPages: number;
}

export async function openPdf(bytes: Uint8Array, options: OpenOptions): Promise<OpenedDocument> {
  let task: { promise: Promise<unknown>; destroy(): Promise<void> } | undefined;
  try {
    task = getDocument({
      data: bytes,
      cMapUrl: CMAP_DIR,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONTS,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const doc = (await task.promise) as unknown as {
      numPages: number;
      getPage(n: number): Promise<unknown>;
      destroy(): Promise<void>;
    };

    if (doc.numPages === 0) throw makeOpenError('E_ZERO_PAGES', 'PDF has zero pages');
    if (doc.numPages > options.maxPages) {
      throw makeOpenError('E_LIMIT', `PDF has ${doc.numPages} pages; limit is ${options.maxPages}`);
    }

    const pages: PageInfo[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = (await doc.getPage(n)) as unknown as {
        getViewport(p: { scale: number }): { width: number; height: number; transform: number[] };
        getTextContent(p?: { disableNormalization?: boolean }): Promise<{ items: unknown[] }>;
        getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
      };
      const viewport = page.getViewport({ scale: 1 });
      const tx = viewport.transform;
      const content = await page.getTextContent({ disableNormalization: true });
      const runs: TextRun[] = [];
      for (const raw of content.items) {
        const item = raw as {
          str?: string;
          width?: number;
          height?: number;
          transform?: number[];
          fontName?: string;
        };
        if (typeof item.str !== 'string' || item.str.length === 0) continue;
        if (!Array.isArray(item.transform) || item.transform.length < 6) continue;
        const rect = textRect(item.transform, item.width ?? 0, item.height ?? 0, tx);
        if (!rect) continue;
        runs.push({
          str: item.str,
          rect,
          fontSize: Math.hypot(item.transform[0]!, item.transform[1]!) || (item.height ?? 0),
          angle: normalizeAngle((Math.atan2(item.transform[1]!, item.transform[0]!) * 180) / Math.PI),
          fontName: item.fontName,
        });
      }
      const drawings = await collectDrawings(page, tx);
      pages.push({
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        rotation: rotationOf(tx),
        runs,
        images: [],
        drawings,
      });
    }

    return { pages, engineVersion: `pdfjs-dist@${pdfjsVersion}` };
  } catch (error) {
    if (isOpenError(error)) throw error;
    throw mapPdfError(error);
  } finally {
    // Do not await here: a destroy failure must not mask the parsed result.
    void task?.destroy().catch(() => undefined);
  }
}

function mapPdfError(error: unknown): Error {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  if (name === 'PasswordException') return makeOpenError('E_ENCRYPTED', message);
  if (name === 'InvalidPDFException') return makeOpenError('E_PARSE', message);
  return makeOpenError('E_PARSE', `${name || 'Error'}: ${message}`);
}

function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return Math.round(a * 1000) / 1000;
}

function rotationOf(tx: number[]): number {
  const a = Math.atan2(tx[1]!, tx[0]!) * (180 / Math.PI);
  return normalizeAngle(a);
}

/**
 * Corners are built in user space from the run's own baseline/up vectors, then
 * mapped through the viewport transform once. Do not scale item.width by the
 * font size again: width is already in user-space units (Spike §11.5).
 */
function textRect(m: number[], width: number, height: number, tx: number[]): Rect | null {
  const len = Math.hypot(m[0]!, m[1]!);
  if (!(len > 0)) return null;
  const ux = m[0]! / len;
  const uy = m[1]! / len;
  const vx = -uy;
  const vy = ux;
  const corners: Array<[number, number]> = [
    [m[4]!, m[5]!],
    [m[4]! + width * ux, m[5]! + width * uy],
    [m[4]! + height * vx, m[5]! + height * vy],
    [m[4]! + width * ux + height * vx, m[5]! + width * uy + height * vy],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const px = tx[0]! * x + tx[2]! * y + tx[4]!;
    const py = tx[1]! * x + tx[3]! * y + tx[5]!;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Bounding box of all path coordinates on a page. A coarse "has vector content" signal. */
async function collectDrawings(
  page: {
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  },
  tx: number[],
): Promise<Array<{ rect: Rect }>> {
  try {
    const ops = await page.getOperatorList();
    const out: Array<{ rect: Rect }> = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.constructPath) continue;
      const args = ops.argsArray[i] as unknown[];
      const coords = Array.isArray(args?.[1]) ? (args[1] as number[]) : Array.isArray(args?.[0]) ? [] : [];
      const nums = coords.filter((n): n is number => typeof n === 'number');
      if (nums.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k + 1 < nums.length; k += 2) {
        const x = tx[0]! * nums[k]! + tx[2]! * nums[k + 1]! + tx[4]!;
        const y = tx[1]! * nums[k]! + tx[3]! * nums[k + 1]! + tx[5]!;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
        out.push({ rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
      }
    }
    return out;
  } catch {
    return [];
  }
}
