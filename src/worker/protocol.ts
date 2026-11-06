import type { Report, VerificationOptions } from '../core/types.js';

export interface WorkerRunRequest {
  type: 'run';
  options: VerificationOptions;
}

export interface WorkerProgress {
  type: 'progress';
  stage: string;
  page?: number;
  pages?: number;
}

export interface WorkerDone {
  type: 'done';
  report: Report;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

export interface WorkerFailed {
  type: 'failed';
  error: string;
  stack?: string;
}

export type WorkerRequest = WorkerRunRequest;
export type WorkerMessage = WorkerProgress | WorkerDone | WorkerFailed;
