// Worker entry: extract text from a PDF inside a worker thread.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { file, pdfjsRoot, maxPages = Infinity } = workerData;
const data = new Uint8Array(await readFile(file));
const task = getDocument({
  data,
  standardFontDataUrl: `${pdfjsRoot}/standard_fonts/`,
  cMapUrl: `${pdfjsRoot}/cmaps/`,
  cMapPacked: true,
  useWorkerFetch: false,
  isEvalSupported: false,
  disableFontFace: true,
  verbosity: 0,
});
const doc = await task.promise;
const total = Math.min(maxPages, doc.numPages);
let chars = 0;
for (let p = 1; p <= total; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent({ disableNormalization: true });
  for (const item of content.items) {
    if (typeof item.str === 'string') chars += item.str.length;
  }
  parentPort.postMessage({ type: 'progress', page: p, pages: doc.numPages, chars });
}
parentPort.postMessage({ type: 'done', numPages: doc.numPages, chars, processed: total });
await task.destroy();
