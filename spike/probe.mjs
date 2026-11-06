// Probe pdfjs text extraction accuracy against generated fixtures.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures');
const OUT = resolve(HERE, 'out');
const PDFJS = resolve(HERE, '..', 'node_modules', 'pdfjs-dist');
await mkdir(OUT, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(FIXTURES, 'manifest.json'), 'utf8'));

async function open(name) {
  const data = new Uint8Array(await readFile(resolve(FIXTURES, name)));
  const task = getDocument({
    data,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    cMapUrl: `${PDFJS}/cmaps/`,
    cMapPacked: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  return { doc, task };
}

// Corners of the text box in device space; handles every /Rotate value and
// text that is itself rotated in user space.
function deviceBox(viewport, item) {
  const m = item.transform;
  const ul = Math.hypot(m[0], m[1]) || 1;
  const vl = Math.hypot(m[2], m[3]) || 1;
  const ux = m[0] / ul, uy = m[1] / ul;
  const vx = m[2] / vl, vy = m[3] / vl;
  const w = item.width;
  const h = item.height;
  const vp = viewport.transform;
  const toDevice = ([x, y]) => [vp[0] * x + vp[2] * y + vp[4], vp[1] * x + vp[3] * y + vp[5]];
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([X, Y]) =>
    toDevice([m[4] + ux * X + vx * Y, m[5] + uy * X + vy * Y]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    fontHeight: Math.hypot(m[0], m[1]),
  };
}

const stats = (arr) => {
  if (!arr.length) return { n: 0, max: 0, mean: 0 };
  const abs = arr.map(Math.abs);
  return { n: arr.length, max: Math.max(...abs), mean: abs.reduce((a, b) => a + b, 0) / abs.length };
};
const boxOfPoints = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

const results = {
  engine: 'pdfjs-dist',
  version: JSON.parse(await readFile(resolve(PDFJS, 'package.json'), 'utf8')).version,
  node: process.version,
  files: {},
  perf: {},
  corrupt: {},
  notext: {},
  empty: {},
  realworld: {},
  notes: [],
};

for (const [name, meta] of Object.entries(manifest.files)) {
  if (meta.kind !== 'coords') continue;
  const size = (await stat(resolve(FIXTURES, name))).size;
  const t0 = performance.now();
  const { doc, task } = await open(name);
  const loadMs = performance.now() - t0;
  const file = { loadMs, bytes: size, pages: [] };

  for (let p = 0; p < meta.pages.length; p++) {
    const expectedPage = meta.pages[p];
    const page = await doc.getPage(p + 1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ disableNormalization: true });
    const items = content.items.filter((i) => typeof i.str === 'string' && i.str.length > 0);

    const dx = [];
    const dy = [];
    const dWidth = [];
    const dHeight = [];
    const dEdge = [];
    const matched = [];
    for (const exp of expectedPage.items) {
      // Pick the same-string item nearest to the expected text origin.
      let best = null;
      for (const it of items) {
        if (it.str !== exp.str) continue;
        const d = Math.hypot(it.transform[4] - exp.x, it.transform[5] - exp.y);
        if (d < 6 && (!best || d < best.d)) best = { it, d };
      }
      if (!best) {
        matched.push({ expected: exp.str, found: false });
        continue;
      }
      const got = best.it;
      const box = deviceBox(viewport, got);
      const rec = {
        expected: exp.str,
        found: true,
        exact: got.str === exp.str,
        size: exp.size,
        dx: got.transform[4] - exp.x,
        dy: got.transform[5] - exp.y,
        dWidth: got.width - exp.width,
        width: got.width,
        expectedWidth: exp.width,
        dHeight: got.height - exp.size,
        fontHeight: box.fontHeight,
        device: box,
      };
      dx.push(rec.dx);
      dy.push(rec.dy);
      dWidth.push(rec.dWidth);
      dHeight.push(rec.dHeight);

      if (typeof exp.angle === 'number') {
        const th = (exp.angle * Math.PI) / 180;
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        const vp = viewport.transform;
        const expPts = [[0, 0], [exp.width, 0], [0, exp.size], [exp.width, exp.size]].map(([X, Y]) => {
          const ux = exp.x + cos * X - sin * Y;
          const uy = exp.y + sin * X + cos * Y;
          return [vp[0] * ux + vp[2] * uy + vp[4], vp[1] * ux + vp[3] * uy + vp[5]];
        });
        const eb = boxOfPoints(expPts);
        rec.expectedBox = eb;
        rec.dEdges = {
          left: box.left - eb.left,
          top: box.top - eb.top,
          right: box.right - eb.right,
          bottom: box.bottom - eb.bottom,
        };
        dEdge.push(rec.dEdges.left, rec.dEdges.top, rec.dEdges.right, rec.dEdges.bottom);
      }
      matched.push(rec);
    }

    const width = viewport.width;
    const height = viewport.height;
    const inside = matched.filter((m) => m.found).every((m) => {
      const b = m.device;
      return b.left >= -0.01 && b.right <= width + 0.01 && b.top >= -0.01 && b.bottom <= height + 0.01;
    });

    file.pages.push({
      page: p + 1,
      rotation: expectedPage.rotation,
      cropBox: expectedPage.cropBox,
      viewport: { width, height },
      items: matched,
      stats: {
        dx: stats(dx),
        dy: stats(dy),
        dWidth: stats(dWidth),
        dHeight: stats(dHeight),
        dEdge: stats(dEdge),
      },
      allInsideViewport: inside,
      textItemCount: items.length,
    });
  }
  await task.destroy();
  results.files[name] = file;
}

// Perf: 100 pages.
{
  const bytes = (await stat(resolve(FIXTURES, 'perf-100p.pdf'))).size;
  const t0 = performance.now();
  const { doc, task } = await open('perf-100p.pdf');
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  let chars = 0;
  let textItems = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ disableNormalization: true });
    for (const item of content.items) {
      if (typeof item.str === 'string') {
        chars += item.str.length;
        textItems++;
      }
    }
    page.cleanup();
  }
  const extractMs = performance.now() - t1;
  const mem = process.memoryUsage();
  results.perf = {
    pages: doc.numPages,
    bytes,
    loadMs: Math.round(loadMs),
    extractMs: Math.round(extractMs),
    msPerPage: +(extractMs / doc.numPages).toFixed(1),
    chars,
    textItems,
    heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1),
    rssMB: +(mem.rss / 1048576).toFixed(1),
  };
  await task.destroy();
}

// No text layer.
{
  const { doc, task } = await open('notext.pdf');
  const page = await doc.getPage(1);
  const content = await page.getTextContent({ disableNormalization: true });
  results.notext = {
    numPages: doc.numPages,
    textItems: content.items.filter((i) => typeof i.str === 'string' && i.str.length > 0).length,
  };
  await task.destroy();
}

// Zero pages: pdf-lib always writes at least one, pypdf can write a truly empty one.
for (const name of ['empty.pdf', 'zero-pages.pdf']) {
  if (!existsSync(resolve(FIXTURES, name))) continue;
  const { doc, task } = await open(name);
  const entry = { numPages: doc.numPages };
  try {
    await doc.getPage(1);
    entry.getPage1 = 'ok';
  } catch (e) {
    entry.getPage1 = `${e?.name}: ${e?.message}`;
  }
  results.empty[name] = entry;
  await task.destroy();
}

// Encrypted with a non-empty user password.
if (existsSync(resolve(FIXTURES, 'encrypted.pdf'))) {
  try {
    const { doc, task } = await open('encrypted.pdf');
    const page = await doc.getPage(1);
    results.encrypted = { opened: true, numPages: doc.numPages, hasPage: !!page };
    await task.destroy();
  } catch (e) {
    results.encrypted = {
      opened: false,
      name: e?.name,
      code: e?.code,
      message: String(e?.message ?? e),
    };
  }
}
// Corrupt file.
{
  try {
    const { doc, task } = await open('corrupt.pdf');
    try {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      results.corrupt = { threw: false, numPages: doc.numPages, items: content.items.length };
    } catch (e) {
      results.corrupt = { threw: true, phase: 'getPage', name: e?.name, message: String(e?.message ?? e) };
    }
    await task.destroy();
  } catch (e) {
    results.corrupt = {
      threw: true,
      phase: 'getDocument',
      name: e?.name,
      message: String(e?.message ?? e),
      code: e?.code,
    };
  }
}

// Real-world PDFs produced by other tools (slides, CJK), if present.
results.realworld = {};
for (const name of ['real-world.pdf', 'real-world-cjk.pdf']) {
  if (!existsSync(resolve(FIXTURES, name))) continue;
  const t0 = performance.now();
  const { doc, task } = await open(name);
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  let chars = 0;
  let items = 0;
  let outside = 0;
  let text = '';
  const pageInfo = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ disableNormalization: true });
    let pageOutside = 0;
    let pageItems = 0;
    for (const item of content.items) {
      if (typeof item.str !== 'string' || item.str.trim() === '') continue;
      pageItems++;
      items++;
      chars += item.str.length;
      text += item.str + '\n';
      const b = deviceBox(viewport, item);
      if (b.left < -0.5 || b.right > viewport.width + 0.5 || b.top < -0.5 || b.bottom > viewport.height + 0.5) pageOutside++;
    }
    outside += pageOutside;
    pageInfo.push({ page: p, items: pageItems, outside: pageOutside });
  }
  results.realworld[name] = {
    pages: doc.numPages,
    bytes: (await stat(resolve(FIXTURES, name))).size,
    loadMs: Math.round(loadMs),
    extractMs: Math.round(performance.now() - t1),
    msPerPage: +((performance.now() - t1) / doc.numPages).toFixed(1),
    chars,
    items,
    outside,
    pageInfo,
    sample: text.replace(/\s+/g, ' ').slice(0, 200),
  };
  await task.destroy();
}

await writeFile(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2));

// Console summary.
for (const [name, file] of Object.entries(results.files)) {
  console.log(`\n${name} (${file.bytes} B, load ${Math.round(file.loadMs)} ms)`);
  for (const p of file.pages) {
    const s = p.stats;
    console.log(
      `  p${p.page} rot=${p.rotation} viewport=${p.viewport.width}x${p.viewport.height} ` +
      `dx[max=${s.dx.max.toFixed(3)}] dy[max=${s.dy.max.toFixed(3)}] ` +
      `dw[max=${s.dWidth.max.toFixed(3)}] dEdge[max=${s.dEdge.max.toFixed(3)}] ` +
      `inside=${p.allInsideViewport}`,
    );
  }
}
console.log('\nperf', results.perf);
console.log('notext', results.notext);
console.log('empty', results.empty);
console.log('corrupt', results.corrupt);
console.log('realworld', results.realworld);
