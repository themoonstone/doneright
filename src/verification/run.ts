import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { aggregateStatus, coverageOf } from '../core/aggregate.js';
import { contractConfirmed, defaultContract, hashContract, loadContractFromFile } from '../core/contract.js';
import { diffIssues, noImprovementStreak } from '../core/diff.js';
import { reportId } from '../core/ids.js';
import type {
  ArtifactRef,
  CheckResult,
  Contract,
  HistoryEntry,
  Issue,
  Limits,
  OverallStatus,
  Report,
  RuntimeInfo,
  VerificationOptions,
  VerificationResult,
} from '../core/types.js';
import { DEFAULT_LIMITS } from '../core/types.js';
import { isOpenError } from '../engine/errors.js';
import { openPdf } from '../engine/pdfjs.js';
import type { OpenedDocument } from '../engine/types.js';
import { runContent } from '../detectors/content.js';
import { runLayout } from '../detectors/layout.js';
import { runStructural } from '../detectors/structural.js';
import { runVisual } from '../detectors/visual.js';
import { makeIssue, skipped } from '../detectors/common.js';
import { appendHistory, historyFor, readHistory, readReport, writeReport } from '../io/reports.js';
import { VERSION } from '../core/version.js';

export async function verify(options: VerificationOptions): Promise<VerificationResult> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const createdAt = new Date().toISOString();
  const id = reportId(new Date(createdAt));

  // Stat before reading so the size limit protects memory, not just the result.
  const info = await stat(options.artifactPath);
  const byteLength = info.size;
  if (byteLength > limits.maxBytes) {
    const contract = await resolveContract(options);
    return finalize({
      options,
      id,
      createdAt,
      sha256: '',
      bytes: byteLength,
      pages: 0,
      contract,
      contractConfirmed: contractConfirmed(contract),
      contractPath: options.contractPath,
      checks: [sizeLimitCheck(byteLength, limits.maxBytes)],
      limits,
      previous: undefined,
    });
  }

  const bytes = new Uint8Array(await readFile(options.artifactPath));
  // pdfjs transfers (detaches) the input buffer, so record the hash now.
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const fileTypeCheck = checkFileType(bytes, options.artifactPath);
  if (fileTypeCheck.status === 'FAIL') {
    return finalize({
      options,
      id,
      createdAt,
      sha256,
      bytes: byteLength,
      pages: 0,
      contract: defaultContract(),
      contractConfirmed: false,
      contractPath: undefined,
      checks: [fileTypeCheck],
      limits,
      previous: undefined,
    });
  }

  let doc: OpenedDocument;
  try {
    doc = await openPdf(bytes, { maxPages: limits.maxPages });
  } catch (error) {
    const check = parseErrorCheck(error);
    const contract = await resolveContract(options);
    return finalize({
      options,
      id,
      createdAt,
      sha256,
      bytes: byteLength,
      pages: 0,
      contract,
      contractConfirmed: contractConfirmed(contract),
      contractPath: options.contractPath,
      checks: [fileTypeCheck, check],
      limits,
      previous: undefined,
    });
  }

  const contract = await resolveContract(options);
  const confirmed = options.contract === undefined && options.contractPath === undefined ? false : contractConfirmed(contract);
  const enabled = buildEnabled(options);
  const ctx = { limits, enabled: (ruleId: string) => enabled(ruleId) };

  const checks: CheckResult[] = [fileTypeCheck];
  checks.push(...guard('pdf.structure', () => runStructural(doc, ctx)));
  checks.push(...guard('pdf.layout', () => runLayout(doc, ctx)));
  checks.push(
    ...guard('pdf.content', () =>
      runContent(doc, { contract, sources: options.sourcePaths ?? [], enabled: ctx.enabled }),
    ),
  );
  checks.push(...guard('pdf.visual', () => runVisual(enabled('pdf.visual.review'))));

  for (const idToDisable of options.disabledChecks ?? []) {
    if (checks.some((c) => c.checkId === idToDisable)) continue;
    checks.push(
      skipped({
        checkId: idToDisable,
        ruleIds: [idToDisable],
        required: false,
        summary: 'Disabled by the user for this run.',
        reason: 'user-disabled',
      }),
    );
  }

  if (options.contractPath === undefined && options.contract === undefined) {
    checks.push({
      checkId: 'contract.confirmed',
      ruleIds: [],
      status: 'UNVERIFIED',
      required: true,
      summary: 'No acceptance contract was supplied; only built-in format rules ran.',
      issues: [],
      limitations: ['Content requirements (sections, phrases, page counts) were not checked because no contract defined them.'],
    });
  } else if (!confirmed) {
    checks.push({
      checkId: 'contract.confirmed',
      ruleIds: [],
      status: 'UNVERIFIED',
      required: true,
      summary: 'The contract contains inferred requirements the user has not confirmed.',
      issues: [],
      limitations: ['Unconfirmed requirements are advisory only; confirm them to let them block delivery.'],
    });
  }

  const previous = await resolvePrevious(options, sha256, hashContract(contract));

  return finalize({
    options,
    id,
    createdAt,
    sha256,
    bytes: byteLength,
    pages: doc.pages.length,
    contract,
    contractConfirmed: confirmed,
    contractPath: options.contractPath,
    checks,
    limits,
    previous,
    engineVersion: doc.engineVersion,
  });
}

interface FinalizeInput {
  options: VerificationOptions;
  id: string;
  createdAt: string;
  sha256: string;
  bytes: number;
  pages: number;
  contract: Contract;
  contractConfirmed: boolean;
  contractPath?: string;
  checks: CheckResult[];
  limits: Limits;
  previous?: Report;
  engineVersion?: string;
}

async function finalize(input: FinalizeInput): Promise<VerificationResult> {
  const { checks } = input;
  const issues = checks.flatMap((c) => c.issues).sort(byPageThenRule);
  const status: OverallStatus = aggregateStatus(checks);

  const report: Report = {
    schemaVersion: '1.0',
    reportId: input.id,
    createdAt: input.createdAt,
    status,
    artifact: {
      path: input.options.artifactPath,
      sha256: input.sha256,
      bytes: input.bytes,
      pages: input.pages,
    },
    contract: {
      hash: hashContract(input.contract),
      confirmed: input.contractConfirmed,
      ...(input.contractPath ? { path: input.contractPath } : {}),
    },
    checks: checks.map(({ skipReason: _skip, ...rest }) => rest),
    issues,
    limitations: collectLimitations(checks),
    runtime: runtimeInfo(input.engineVersion),
    coverage: coverageOf(checks),
  };

  const outDir = input.options.outDir;
  if (input.previous) {
    const older = await olderIssueIds(outDir, input.sha256, report.contract.hash, input.previous.reportId);
    const diff = diffIssues(input.previous, issues, older);
    const history = outDir ? await readHistory(outDir) : [];
    diff.noImprovementStreak = noImprovementStreak([
      ...history
        .filter((h) => h.artifactSha256 === input.sha256 && h.contractHash === report.contract.hash)
        .map((h) => ({ status: h.status, confirmedIssues: h.confirmedIssues })),
      { status, confirmedIssues: confirmedCount(issues) },
    ]);
    report.diff = diff;
  }

  const result: VerificationResult = { report };
  if (outDir && input.options.writeReports !== false) {
    const written = await writeReport(report, outDir);
    result.reportJsonPath = written.jsonPath;
    result.reportMarkdownPath = written.markdownPath;
    await appendHistory(outDir, historyEntry(report));
  }
  return result;
}

function historyEntry(report: Report): HistoryEntry {
  return {
    reportId: report.reportId,
    artifactSha256: report.artifact.sha256,
    artifactPath: report.artifact.path,
    contractHash: report.contract.hash,
    status: report.status,
    confirmedIssues: confirmedCount(report.issues),
    at: report.createdAt,
  };
}

function confirmedCount(issues: Issue[]): number {
  return issues.filter((i) => i.confidence === 'confirmed' && i.severity !== 'info').length;
}

async function olderIssueIds(
  outDir: string | undefined,
  sha256: string,
  contractHash: string,
  previousReportId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!outDir) return ids;
  const history = await readHistory(outDir);
  for (const entry of historyFor(history, sha256, contractHash, 5)) {
    if (entry.reportId === previousReportId) continue;
    try {
      const report = await readReport(`${outDir}/reports/${entry.reportId}/report.json`);
      for (const issue of report.issues) ids.add(issue.id);
    } catch {
      // Missing or unreadable older reports only weaken regression detection.
    }
  }
  return ids;
}

async function resolvePrevious(
  options: VerificationOptions,
  sha256: string,
  contractHash: string,
): Promise<Report | undefined> {
  if (options.previousReport) {
    return readReport(options.previousReport);
  }
  if (!options.outDir) return undefined;
  const history = await readHistory(options.outDir);
  const latest = historyFor(history, sha256, contractHash, 1)[0];
  if (!latest) return undefined;
  try {
    return await readReport(`${options.outDir}/reports/${latest.reportId}/report.json`);
  } catch {
    return undefined;
  }
}

function collectLimitations(checks: CheckResult[]): string[] {
  const out: string[] = [];
  for (const check of checks) out.push(...(check.limitations ?? []));
  out.push('PASS means no blocking problem was found within the checks listed above; it does not prove the artifact is perfect.');
  return [...new Set(out)];
}

function runtimeInfo(engineVersion?: string): RuntimeInfo {
  return {
    doneright: VERSION,
    engine: engineVersion ?? 'pdfjs-dist',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

function byPageThenRule(a: Issue, b: Issue): number {
  const pa = a.page ?? 0;
  const pb = b.page ?? 0;
  if (pa !== pb) return pa - pb;
  return a.ruleId.localeCompare(b.ruleId);
}

function buildEnabled(options: VerificationOptions): (ruleId: string) => boolean {
  const only = options.enabledChecks;
  const off = new Set(options.disabledChecks ?? []);
  return (ruleId: string) => {
    if (off.has(ruleId)) return false;
    if (only && only.length > 0) {
      return only.some((prefix) => ruleId === prefix || ruleId.startsWith(`${prefix}.`));
    }
    return true;
  };
}

function guard(label: string, fn: () => CheckResult[]): CheckResult[] {
  try {
    return fn();
  } catch (error) {
    return [
      {
        checkId: label,
        ruleIds: [label],
        status: 'ERROR',
        required: true,
        summary: `Checker crashed: ${(error as Error).message}`,
        issues: [
          makeIssue({
            ruleId: label,
            severity: 'major',
            page: null,
            message: `Checker "${label}" failed to run: ${(error as Error).message}`,
            evidence: (error as Error).stack?.split('\n').slice(0, 3).join(' | '),
          }),
        ],
      },
    ];
  }
}

function sizeLimitCheck(actual: number, max: number): CheckResult {
  return {
    checkId: 'pdf.limits.file-size',
    ruleIds: ['pdf.limits.file-size'],
    status: 'ERROR',
    required: true,
    summary: `Artifact is ${actual.toLocaleString('en-US')} bytes, over the ${max.toLocaleString('en-US')} byte limit; inspection did not run.`,
    issues: [
      makeIssue({
        ruleId: 'pdf.limits.file-size',
        severity: 'major',
        page: null,
        message: 'File size limit exceeded, so the checks could not produce a conclusion.',
        evidence: `bytes=${actual}, limit=${max}`,
        suggestedFix: 'Raise the limit (limits.maxBytes) or verify a smaller artifact.',
      }),
    ],
    limitations: ['No page, text, or layout data was read for this run.'],
  };
}

function checkFileType(bytes: Uint8Array, path: string): CheckResult {
  const magic = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
  const ext = path.toLowerCase().endsWith('.pdf');
  if (magic === '%PDF-') {
    return {
      checkId: 'pdf.structure.file-type',
      ruleIds: ['pdf.structure.file-type', 'builtin.file-type'],
      status: 'PASS',
      required: true,
      summary: 'Artifact is a PDF (magic header present).',
      issues: [],
    };
  }
  return {
    checkId: 'pdf.structure.file-type',
    ruleIds: ['pdf.structure.file-type', 'builtin.file-type'],
    status: 'FAIL',
    required: true,
    summary: 'Artifact is not a PDF: the %PDF- header is missing.',
    issues: [
      makeIssue({
        ruleId: 'pdf.structure.file-type',
        severity: 'blocking',
        page: null,
        message: `Not a PDF file (header "${magic}"), so PDF checks cannot run.`,
        evidence: `extension ${ext ? '.pdf' : 'not .pdf'}`,
        suggestedFix: 'Point DoneRight at the final PDF, or export the deliverable as PDF.',
      }),
    ],
  };
}

function parseErrorCheck(error: unknown): CheckResult {
  const base = {
    checkId: 'pdf.structure.parse',
    ruleIds: ['pdf.structure.parse'],
    required: true,
  };
  if (isOpenError(error)) {
    if (error.code === 'E_ENCRYPTED') {
      return {
        ...base,
        status: 'ERROR',
        summary: 'PDF is password-protected; inspection did not run.',
        issues: [
          makeIssue({
            ruleId: 'pdf.structure.parse',
            severity: 'major',
            page: null,
            message: 'The PDF requires a password, so no check could run.',
            suggestedFix: 'Export an unencrypted copy for acceptance.',
          }),
        ],
      };
    }
    const message =
      error.code === 'E_ZERO_PAGES'
        ? 'PDF has zero pages.'
        : error.code === 'E_LIMIT'
          ? `PDF has more pages than the configured limit (${error.detail ?? 'limit exceeded'}).`
          : `PDF could not be parsed (${error.detail ?? error.message}).`;
    return {
      ...base,
      status: 'ERROR',
      summary: message,
      issues: [
        makeIssue({
          ruleId: 'pdf.structure.parse',
          severity: 'major',
          page: null,
          message,
          evidence: error.detail,
          suggestedFix: 'Regenerate or repair the PDF, then re-run the same checks.',
        }),
      ],
    };
  }
  return {
    ...base,
    status: 'ERROR',
    summary: `PDF engine failed: ${(error as Error).message}`,
    issues: [makeIssue({ ruleId: 'pdf.structure.parse', severity: 'major', page: null, message: String(error) })],
  };
}

async function resolveContract(options: VerificationOptions): Promise<Contract> {
  if (options.contract) return options.contract;
  if (options.contractPath) return loadContractFromFile(options.contractPath);
  return defaultContract();
}
