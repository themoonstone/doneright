/** Public data model for DoneRight reports. Kept dependency-free so it can be reused by the CLI. */

export type Severity = 'blocking' | 'major' | 'minor' | 'info';

export type CheckStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'UNVERIFIED' | 'SKIPPED' | 'ERROR';

export type OverallStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'ERROR';

/** Normalized box, origin top-left, all values in [0, 1]. */
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SkipReason = 'user-disabled' | 'not-applicable' | 'limit-exceeded';

export interface Issue {
  id: string;
  ruleId: string;
  severity: Severity;
  /** 1-based page number; null for document-level issues. */
  page: number | null;
  bbox?: Bbox;
  message: string;
  evidence?: string;
  suggestedFix?: string;
  /** confirmed issues may fail a check; suspected ones only push it to REVIEW. */
  confidence: 'confirmed' | 'suspected';
}

export interface CheckResult {
  checkId: string;
  ruleIds: string[];
  status: CheckStatus;
  /** required = contract blocking/major or builtin P0. */
  required: boolean;
  summary: string;
  issues: Issue[];
  metrics?: Record<string, number | string>;
  limitations?: string[];
  skipReason?: SkipReason;
}

export type RequirementKind =
  | 'file-type'
  | 'page-count'
  | 'section'
  | 'heading'
  | 'phrase'
  | 'prohibited'
  | 'order';

export interface Requirement {
  id: string;
  kind: RequirementKind;
  /** Primary value (section title, phrase, forbidden text). */
  value?: string;
  /** Values for `order` requirements, in expected order. */
  values?: string[];
  min?: number;
  max?: number;
  severity: Severity;
  source: 'user' | 'inferred';
  confirmedByUser?: boolean;
  caseSensitive?: boolean;
  /** Optional hint; checks still scan the whole document. */
  pages?: number[];
}

export interface ContractOptions {
  strictHeadings?: boolean;
  stripRunningHeaders?: boolean;
  fuzzyPass?: number;
  fuzzyReview?: number;
}

export interface Contract {
  schemaVersion: '1.0';
  contractId: string;
  artifactPath?: string;
  requirements: Requirement[];
  options?: ContractOptions;
  sourcePaths?: string[];
}

export interface ArtifactRef {
  path: string;
  sha256: string;
  bytes: number;
  pages: number;
}

export interface ContractRef {
  path?: string;
  hash: string;
  confirmed: boolean;
}

export interface RuntimeInfo {
  doneright: string;
  engine: string;
  node: string;
  platform: string;
}

export type DiffClass = 'resolved' | 'persisting' | 'new' | 'regressed';

export interface IssueDiff {
  issueId: string;
  ruleId: string;
  page: number | null;
  classification: DiffClass;
  previousIssueId?: string;
}

export interface DiffSummary {
  previousReportId: string;
  resolved: number;
  persisting: number;
  new: number;
  regressed: number;
  items: IssueDiff[];
  noImprovementStreak: number;
}

export interface Report {
  schemaVersion: '1.0';
  reportId: string;
  createdAt: string;
  status: OverallStatus;
  artifact: ArtifactRef;
  contract: ContractRef;
  checks: Array<Omit<CheckResult, 'skipReason'>>;
  issues: Issue[];
  limitations: string[];
  runtime: RuntimeInfo;
  diff?: DiffSummary;
  coverage: {
    executed: number;
    skipped: number;
    unverified: number;
    failed: number;
  };
}

export interface HistoryEntry {
  reportId: string;
  artifactSha256: string;
  artifactPath: string;
  contractHash: string;
  status: OverallStatus;
  confirmedIssues: number;
  at: string;
}

export interface Limits {
  maxBytes: number;
  maxPages: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxBytes: 100 * 1024 * 1024,
  maxPages: 300,
  timeoutMs: 180_000,
};

/** Everything the verifier needs for one run. */
export interface VerificationOptions {
  artifactPath: string;
  contractPath?: string;
  contract?: Contract;
  sourcePaths?: string[];
  outDir?: string;
  previousReport?: string;
  enabledChecks?: string[];
  disabledChecks?: string[];
  strictHeadings?: boolean;
  limits?: Partial<Limits>;
  /** When false, reports are returned but not written to disk. */
  writeReports?: boolean;
}

export interface VerificationResult {
  report: Report;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}
