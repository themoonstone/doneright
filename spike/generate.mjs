// Generate calibration fixtures with known text coordinates.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const OUT = new URL('./fixtures/', import.meta.url);
await mkdir(OUT, { recursive: true });

const A4_W = 612;
const A4_H = 792;
const FONT_FILE = 'C:/Windows/Fonts/simhei.ttf';
const manifest = { generatedAt: new Date().toISOString(), engine: 'pdf-lib', files: {} };

// Sum of per-glyph advances. pdf-lib's widthOfTextAtSize() disagrees with its own
// per-glyph widths for some strings (observed on "ROTATE": 45.072 vs 48.672), so
// the reference width is built from per-glyph advances instead.
const widthOf = (font, str, size) =>
  Array.from(str).reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0);

async function save(doc, name, meta) {
  const bytes = await doc.save();
  await writeFile(new URL(name, OUT), bytes);
  manifest.files[name] = meta;
  return bytes;
}

// 1. Font sizes: 8 / 10 / 12 / 14 pt at known points.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([A4_W, A4_H]);
  const items = [];
  const sizes = [8, 10, 12, 14];
  const str = 'Hamburgefonstiv 0123456789';
  sizes.forEach((size, i) => {
    const x = 72;
    const y = 740 - i * 60;
    page.drawText(str, { x, y, size, font, color: rgb(0, 0, 0) });
    items.push({ str, x, y, size, font: 'Helvetica', width: widthOf(font, str, size) });
  });
  await save(doc, 'fontsizes.pdf', {
    kind: 'coords',
    pages: [{ width: A4_W, height: A4_H, rotation: 0, cropBox: null, items }],
  });
}

// 2. Rotations: same content, /Rotate 0/90/180/270.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const width = 300;
  const height = 200;
  const pages = [];
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([width, height]);
    page.setRotation(degrees(rotation));
    const items = [];
    for (const [x, y, str] of [[40, 80, 'ROTATE'], [40, 140, 'MARKER']]) {
      page.drawText(str, { x, y, size: 12, font, color: rgb(0, 0, 0) });
      items.push({ str, x, y, size: 12, font: 'Helvetica', width: widthOf(font, str, 12) });
    }
    pages.push({ width, height, rotation, cropBox: null, items });
  }
  await save(doc, 'rotations.pdf', { kind: 'coords', pages });
}

// 3. CropBox offset: media 600x800, crop (50,100,400,500).
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  const cropBox = [50, 100, 400, 500];
  page.setCropBox(cropBox[0], cropBox[1], cropBox[2], cropBox[3]);
  const items = [];
  for (const [x, y, str] of [[100, 200, 'CROP-A'], [300, 450, 'CROP-B']]) {
    page.drawText(str, { x, y, size: 12, font, color: rgb(0, 0, 0) });
    items.push({ str, x, y, size: 12, font: 'Helvetica', width: widthOf(font, str, 12) });
  }
  await save(doc, 'cropbox.pdf', {
    kind: 'coords',
    pages: [{ width: 600, height: 800, rotation: 0, cropBox, items }],
  });
}

// 4. Text rotated in user space (30 / 90 degrees).
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([A4_W, A4_H]);
  const items = [];
  for (const [x, y, angle, str] of [[100, 400, 30, 'ANGLE-30'], [300, 400, 90, 'ANGLE-90']]) {
    page.drawText(str, { x, y, size: 12, font, rotate: degrees(angle), color: rgb(0, 0, 0) });
    items.push({ str, x, y, size: 12, angle, font: 'Helvetica', width: widthOf(font, str, 12) });
  }
  await save(doc, 'angled.pdf', {
    kind: 'coords',
    pages: [{ width: A4_W, height: A4_H, rotation: 0, cropBox: null, items }],
  });
}

// 4b. Fractional coordinates and sizes: float round-trip, not just integers.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([A4_W, A4_H]);
  const items = [];
  const cases = [
    [72.37, 700.11, 9.37, 'FRAC-A'],
    [113.61, 655.93, 10.5, 'FRAC-B'],
    [98.19, 611.47, 11.73, 'FRAC-C'],
  ];
  for (const [x, y, size, str] of cases) {
    page.drawText(str, { x, y, size, font, color: rgb(0, 0, 0) });
    items.push({ str, x, y, size, font: 'Helvetica', width: widthOf(font, str, size) });
  }
  await save(doc, 'fractional.pdf', {
    kind: 'coords',
    pages: [{ width: A4_W, height: A4_H, rotation: 0, cropBox: null, items }],
  });
}

// 5. CJK: embedded SimHei subset.
{
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const cjk = await doc.embedFont(await readFile(FONT_FILE), { subset: true });
  const page = doc.addPage([A4_W, A4_H]);
  const str = '中文测试：第十五章 英语发音练习。';
  const x = 72;
  const y = 700;
  const size = 12;
  page.drawText(str, { x, y, size, font: cjk, color: rgb(0, 0, 0) });
  await save(doc, 'cjk.pdf', {
    kind: 'coords',
    pages: [{
      width: A4_W,
      height: A4_H,
      rotation: 0,
      cropBox: null,
      items: [{ str, x, y, size, font: 'SimHei', width: widthOf(cjk, str, size) }],
    }],
  });
}

// 5. Performance: 100 pages x 30 lines x 80 chars.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = 'The quick brown fox jumps over the lazy dog 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz';
  for (let p = 0; p < 100; p++) {
    const page = doc.addPage([A4_W, A4_H]);
    for (let i = 0; i < 30; i++) {
      page.drawText(`${String(p + 1).padStart(3, '0')}-${String(i + 1).padStart(2, '0')} ${line}`.slice(0, 80), {
        x: 40,
        y: 740 - i * 22,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }
  await save(doc, 'perf-100p.pdf', { kind: 'perf', pages: 100, charsPerPage: 30 * 80 });
}

// 6. No text layer (image/vector only) - stands in for a scanned page.
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_W, A4_H]);
  page.drawRectangle({ x: 100, y: 300, width: 400, height: 200, color: rgb(0.2, 0.2, 0.2) });
  await save(doc, 'notext.pdf', { kind: 'notext', pages: 1 });
}

// 7. Zero-page PDF.
{
  const doc = await PDFDocument.create();
  await save(doc, 'empty.pdf', { kind: 'empty' });
}

// 8. Corrupt: truncated copy.
{
  const bytes = await readFile(new URL('fontsizes.pdf', OUT));
  await writeFile(new URL('corrupt.pdf', OUT), bytes.subarray(0, Math.floor(bytes.length * 0.4)));
  manifest.files['corrupt.pdf'] = { kind: 'corrupt' };
}

await writeFile(new URL('manifest.json', OUT), JSON.stringify(manifest, null, 2));
console.log(`fixtures written to ${OUT.pathname}`);
for (const name of Object.keys(manifest.files)) console.log(' -', name);
