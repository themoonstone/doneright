import { parentPort } from 'node:worker_threads';
import { verify } from '../verification/run.js';
import type { WorkerMessage, WorkerRequest } from './protocol.js';

if (!parentPort) throw new Error('doneright worker must run inside a worker thread');

const port = parentPort;

port.on('message', (message: WorkerRequest) => {
  if (!message || message.type !== 'run') return;
  void run(message);
});

async function run(message: WorkerRequest): Promise<void> {
  try {
    post({ type: 'progress', stage: 'opening' });
    const result = await verify(message.options);
    post({
      type: 'done',
      report: result.report,
      ...(result.reportJsonPath ? { reportJsonPath: result.reportJsonPath } : {}),
      ...(result.reportMarkdownPath ? { reportMarkdownPath: result.reportMarkdownPath } : {}),
    });
  } catch (error) {
    const err = error as Error;
    post({ type: 'failed', error: err.message, ...(err.stack ? { stack: err.stack } : {}) });
  }
}

function post(message: WorkerMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // The parent may have terminated us; nothing useful left to do.
  }
}
