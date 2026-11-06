import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { VerificationOptions, VerificationResult } from '../core/types.js';
import { loadContractFromFile } from '../core/contract.js';
import { verify } from '../verification/run.js';

/** Minimal structural types: the plugin must not import DSH packages. */
export interface ToolLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>;
  };
  execute(args: unknown, exec?: ToolExecLike): Promise<unknown>;
}

export interface ToolExecLike {
  readonly agent?: unknown;
  readonly signal?: AbortSignal;
}

export interface CommandInvocationLike {
  readonly agent?: unknown;
  readonly signal?: AbortSignal;
  readonly rawInput?: string;
  readonly input?: { text?: string };
}

/** The host workingDirectory service: one owner for each Session's directory. */
interface WorkingDirectoryLike {
  ensure(agent: unknown, signal?: AbortSignal): Promise<string>;
}

export interface HarnessContext {
  tools?: { register(definition: unknown, options?: Record<string, unknown>): () => void };
  commands?: { register(definition: unknown): () => void };
  logger?: { debug?(msg: string): void; warn?(msg: string): void };
  get?(name: string): unknown;
}

export interface PluginConfig {
  /** Force a workspace root instead of asking the host workingDirectory service. */
  workspaceRoot?: string;
  /** Where reports and history.jsonl go. Defaults to <workspace>/.doneright. */
  outDir?: string;
  maxBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
  /** Refuse artifacts outside the agent workspace (default true). */
  restrictToWorkspace?: boolean;
}

const DEFAULTS: Required<PluginConfig> = {
  workspaceRoot: '',
  outDir: '',
  maxBytes: 100 * 1024 * 1024,
  maxPages: 300,
  timeoutMs: 180_000,
  restrictToWorkspace: true,
};

export function registerDoneRight(ctx: HarnessContext, config: PluginConfig = {}): () => void {
  const settings = { ...DEFAULTS, ...config };
  const disposers: Array<() => void> = [];
  const workingDirectory = asWorkingDirectory(ctx.get?.('workingDirectory'));

  if (ctx.tools) {
    disposers.push(ctx.tools.register(toolDefinition(settings, workingDirectory), {}));
  }
  if (ctx.commands) {
    disposers.push(ctx.commands.register(commandDefinition(settings, workingDirectory)));
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

function asWorkingDirectory(value: unknown): WorkingDirectoryLike | undefined {
  if (value && typeof value === 'object' && typeof (value as WorkingDirectoryLike).ensure === 'function') {
    return value as WorkingDirectoryLike;
  }
  return undefined;
}

/**
 * Resolve the agent's effective directory. Tool and command calls carry the
 * live Agent, and the host's workingDirectory service owns that mapping; the
 * process cwd is only a fallback (e.g. unit tests).
 */
async function baseDir(
  settings: Required<PluginConfig>,
  workingDirectory: WorkingDirectoryLike | undefined,
  agent: unknown,
  signal?: AbortSignal,
): Promise<string> {
  if (settings.workspaceRoot) return resolve(settings.workspaceRoot);
  if (workingDirectory && agent) {
    try {
      return await workingDirectory.ensure(agent, signal);
    } catch {
      // Fall through: a missing session directory must not break verification.
    }
  }
  return process.cwd();
}

function resolveOutDir(settings: Required<PluginConfig>, base: string, explicit?: string): string {
  const dir = explicit ?? settings.outDir;
  if (dir) return isAbsolute(dir) ? dir : resolve(base, dir);
  return resolve(base, '.doneright');
}

function stripExtended(path: string): string {
  if (process.platform !== 'win32') return path;
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

/**
 * Resolve symlinks/junctions before the workspace prefix check, so a link
 * inside the workspace cannot be used to read a file outside it.
 */
function canonical(path: string): string {
  try {
    return stripExtended(realpathSync.native(path));
  } catch {
    return path;
  }
}

function assertAuthorized(path: string, base: string, settings: Required<PluginConfig>): string {
  const absolute = canonical(isAbsolute(path) ? path : resolve(base, path));
  if (!settings.restrictToWorkspace) return absolute;
  const root = canonical(base);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to read ${absolute}: it is outside the workspace (${base}).`);
  }
  return absolute;
}

function buildOptions(
  settings: Required<PluginConfig>,
  base: string,
  input: {
    path: string;
    contract?: string;
    sources?: string[];
    outDir?: string;
    previousReport?: string;
    strictHeadings?: boolean;
    disabledChecks?: string[];
  },
): VerificationOptions {
  const artifactPath = assertAuthorized(input.path, base, settings);
  const contractPath = input.contract ? assertAuthorized(input.contract, base, settings) : undefined;
  const options: VerificationOptions = {
    artifactPath,
    outDir: resolveOutDir(settings, base, input.outDir),
    limits: { maxBytes: settings.maxBytes, maxPages: settings.maxPages, timeoutMs: settings.timeoutMs },
    writeReports: true,
  };
  if (contractPath) options.contractPath = contractPath;
  if (input.sources?.length) {
    options.sourcePaths = input.sources.map((s) => assertAuthorized(s, base, settings));
  }
  if (input.previousReport) options.previousReport = assertAuthorized(input.previousReport, base, settings);
  if (typeof input.strictHeadings === 'boolean') options.strictHeadings = input.strictHeadings;
  if (input.disabledChecks?.length) options.disabledChecks = input.disabledChecks;
  return options;
}

function summarize(result: VerificationResult): Record<string, unknown> {
  const { report } = result;
  return prune({
    status: report.status,
    reportId: report.reportId,
    artifact: report.artifact.path,
    pages: report.artifact.pages,
    coverage: report.coverage,
    issues: report.issues.slice(0, 40).map((i) => ({
      id: i.id,
      ruleId: i.ruleId,
      severity: i.severity,
      page: i.page,
      bbox: i.bbox,
      message: i.message,
      evidence: i.evidence,
      suggestedFix: i.suggestedFix,
      confidence: i.confidence,
    })),
    issueCount: report.issues.length,
    checks: report.checks.map((c) => ({ id: c.checkId, status: c.status, required: c.required, summary: c.summary })),
    limitations: report.limitations,
    reportPath: result.reportJsonPath,
    markdownPath: result.reportMarkdownPath,
    diff: report.diff,
  });
}

/**
 * The Host requires a lossless JSON value from a tool. `undefined` object
 * properties fail that check even though JSON.stringify would drop them,
 * so remove them before returning.
 */
function prune<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => prune(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = prune(item);
    }
    return out as T;
  }
  return value;
}

function textBlock(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }];
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL', 'REVIEW', 'ERROR'] },
    reportId: { type: 'string' },
    artifact: { type: 'string' },
    issueCount: { type: 'number' },
    reportPath: { type: 'string' },
    markdownPath: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'reportId', 'artifact'],
} as const;

function formatResult(value: Record<string, unknown>): string {
  const status = String(value.status);
  const issues = Number(value.issueCount ?? 0);
  const lines = [
    `DoneRight: ${status} — ${value.artifact} (${String(value.pages ?? '?')} pages, ${issues} issue(s))`,
    `report: ${String(value.reportPath ?? value.markdownPath ?? 'not written')}`,
  ];
  if (status !== 'PASS' && Array.isArray(value.issues)) {
    for (const raw of value.issues.slice(0, 8) as Array<Record<string, unknown>>) {
      lines.push(`- [${String(raw.severity)}] ${raw.page ? `p.${String(raw.page)} ` : ''}${String(raw.message)}`);
    }
  }
  return lines.join('\n');
}

export function toolDefinition(
  settings: Required<PluginConfig>,
  workingDirectory?: WorkingDirectoryLike,
): ToolLike {
  return {
    name: 'doneright_check',
    description:
      'Verify a generated PDF deliverable against an acceptance contract and return an evidence-based PASS/FAIL/REVIEW/ERROR report with page-level issues. ' +
      'Use it after producing a PDF and before claiming the work is complete. ' +
      'It does not edit the artifact and does not call a vision model. ' +
      'Do not use it for non-PDF files (V0.1 supports PDF only).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Path to the PDF to inspect, relative to the workspace.' },
        contract: {
          type: 'string',
          description: 'Optional path to a contract JSON file. Without it only built-in format checks run and the result is REVIEW.',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source material paths recorded as provenance. Content matching uses the contract, not free text.',
        },
        outDir: { type: 'string', description: 'Optional report directory. Defaults to <workspace>/.doneright.' },
        previousReport: { type: 'string', description: 'Optional path to a previous report.json to diff against.' },
        strictHeadings: { type: 'boolean', description: 'Require headings to start a line rather than match anywhere.' },
        disabledChecks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Check ids to skip for this run; they are listed as SKIPPED in the report.',
        },
      },
      required: ['path'],
    },
    output: {
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      render(_args: unknown, value: unknown) {
        return textBlock(formatResult(value as Record<string, unknown>));
      },
    },
    async execute(raw: unknown, exec?: ToolExecLike): Promise<unknown> {
      const args = (raw ?? {}) as Record<string, unknown>;
      const path = String(args.path ?? '');
      if (!path) throw new Error('doneright_check requires "path".');
      const base = await baseDir(settings, workingDirectory, exec?.agent, exec?.signal);
      const options = buildOptions(settings, base, {
        path,
        contract: typeof args.contract === 'string' ? args.contract : undefined,
        sources: Array.isArray(args.sources) ? args.sources.map(String) : undefined,
        outDir: typeof args.outDir === 'string' ? args.outDir : undefined,
        previousReport: typeof args.previousReport === 'string' ? args.previousReport : undefined,
        strictHeadings: typeof args.strictHeadings === 'boolean' ? args.strictHeadings : undefined,
        disabledChecks: Array.isArray(args.disabledChecks) ? args.disabledChecks.map(String) : undefined,
      });
      const result = await verify(options);
      return summarize(result);
    },
  };
}

export function commandDefinition(
  settings: Required<PluginConfig>,
  workingDirectory?: WorkingDirectoryLike,
): unknown {
  return {
    name: 'doneright',
    description: 'Run DoneRight on a PDF: /doneright <path> [--contract <file>] [--strict] [--json]',
    input: { hint: '<path> [--contract <file>] [--strict] [--json]' },
    async handler(
      invocation: CommandInvocationLike,
    ): Promise<{ kind: 'success' | 'error'; text: string }> {
      const text = invocation.rawInput ?? invocation.input?.text ?? '';
      const parsed = parseCommandInput(text);
      if (!parsed.path) {
        return { kind: 'error', text: 'Usage: /doneright <path> [--contract <file>] [--strict] [--json]' };
      }
      try {
        const base = await baseDir(settings, workingDirectory, invocation.agent, invocation.signal);
        const options = buildOptions(settings, base, {
          path: parsed.path,
          contract: parsed.contract,
          strictHeadings: parsed.strict,
        });
        if (parsed.json) {
          const contract = options.contractPath ? await loadContractFromFile(options.contractPath) : undefined;
          if (contract) options.contract = contract;
        }
        const result = await verify(options);
        const summary = summarize(result);
        return { kind: 'success', text: parsed.json ? JSON.stringify(summary, null, 2) : formatResult(summary) };
      } catch (error) {
        return { kind: 'error', text: `DoneRight failed: ${(error as Error).message}` };
      }
    },
  };
}

export function parseCommandInput(input: string): {
  path?: string;
  contract?: string;
  strict: boolean;
  json: boolean;
} {
  const tokens = input.match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) ?? [];
  const out: { path?: string; contract?: string; strict: boolean; json: boolean } = { strict: false, json: false };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '--contract') {
      out.contract = tokens[++i];
    } else if (token === '--strict') {
      out.strict = true;
    } else if (token === '--json') {
      out.json = true;
    } else if (!token.startsWith('--') && !out.path) {
      out.path = token;
    }
  }
  return out;
}
