// Verify pdfjs runs inside a worker_thread on Node 24, and that a terminated
// worker leaves the parent process healthy with partial results.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDFJS = resolve(HERE, '..', 'node_modules', 'pdfjs-dist');
const FIXTURES = resolve(HERE, 'fixtures');
await mkdir(resolve(HERE, 'out'), { recursive: true });

function run(file, { maxPages = Infinity, terminateAfterFirstProgress = false } = {}) {
  return new Promise((resolvePromise) => {
    const t0 = performance.now();
    const worker = new Worker(new URL('./worker-entry.mjs', import.meta.url), {
      type: 'module',
      workerData: { file, pdfjsRoot: PDFJS, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const events = [];
    let terminated = false;
    worker.on('message', (msg) => {
      events.push(msg);
      if (terminateAfterFirstProgress && !terminated && msg.type === 'progress') {
        terminated = true;
        worker.terminate();
      }
    });
    worker.on('error', (err) => {
      events.push({ type: 'error', name: err?.name, message: String(err?.message ?? err) });
    });
    worker.on('exit', (code) => {
      resolvePromise({
        file: file.split(/[\\/]/).pop(),
        code,
        terminated,
        ms: Math.round(performance.now() - t0),
        events: events.length,
        progress: events.filter((e) => e.type === 'progress').length,
        done: events.find((e) => e.type === 'done') ?? null,
        error: events.find((e) => e.type === 'error') ?? null,
        peakHeapMB: null,
      });
    });
    worker.postMessage({});
  });
}

const results = {};
results.perf100 = await run(resolve(FIXTURES, 'perf-100p.pdf'));
results.cjk63 = await run(resolve(FIXTURES, 'real-world-cjk.pdf'));
results.terminated = await run(resolve(FIXTURES, 'real-world-cjk.pdf'), {
  maxPages: 5,
  terminateAfterFirstProgress: true,
});

// Parent must still be able to run pdfjs after a worker was killed.
{
  const t0 = performance.now();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(await import('node:fs/promises').then((fs) => fs.readFile(resolve(FIXTURES, 'fontsizes.pdf')))),
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  results.parentAfterKill = { numPages: doc.numPages, ms: Math.round(performance.now() - t0) };
  await task.destroy();
}

await writeFile(resolve(HERE, 'out', 'worker-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
