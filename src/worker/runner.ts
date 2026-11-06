import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { VerificationOptions, VerificationResult } from '../core/types.js';
import type { WorkerMessage } from './protocol.js';

export interface WorkerOptions {
  /** Hard wall-clock limit for the whole inspection. */
  timeoutMs: number;
  /** Old-generation heap cap for the worker, in megabytes. */
  maxOldGenerationSizeMb?: number;
}

export class WorkerTimeoutError extends Error {
  constructor(ms: number) {
    super(`Inspection exceeded ${ms}ms and was terminated.`);
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * Run one verification in an isolated worker so a pdfjs crash, OOM, or an
 * infinite loop cannot take down the Harness process.
 */
export function verifyInWorker(options: VerificationOptions, workerOptions: WorkerOptions): Promise<VerificationResult> {
  const entry = fileURLToPath(new URL('./entry.js', import.meta.url));
  const worker = new Worker(entry, {
    resourceLimits: { maxOldGenerationSizeMb: workerOptions.maxOldGenerationSizeMb ?? 512 },
    // pdfjs installs a lot of listeners; keep output clean.
    stdout: true,
    stderr: true,
  });

  return new Promise<VerificationResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new WorkerTimeoutError(workerOptions.timeoutMs));
    }, workerOptions.timeoutMs);
    timer.unref?.();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'done') {
        finish(() =>
          resolve({
            report: message.report,
            ...(message.reportJsonPath ? { reportJsonPath: message.reportJsonPath } : {}),
            ...(message.reportMarkdownPath ? { reportMarkdownPath: message.reportMarkdownPath } : {}),
          }),
        );
      } else if (message.type === 'failed') {
        finish(() => reject(new Error(message.error)));
      }
    });

    worker.on('error', (error) => finish(() => reject(error)));
    worker.on('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`Inspection worker exited with code ${code}.`)));
    });

    worker.postMessage({ type: 'run', options });
  });
}
