import { issueId } from '../core/ids.js';
import type { Bbox, CheckResult, CheckStatus, Issue, Severity } from '../core/types.js';
import type { PageInfo, Rect } from '../engine/types.js';

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Convert a point-space rect into the normalized [0,1] report convention. */
export function toBbox(rect: Rect, page: PageInfo): Bbox {
  const w = page.width > 0 ? page.width : 1;
  const h = page.height > 0 ? page.height : 1;
  const x = clamp01(rect.x / w);
  const y = clamp01(rect.y / h);
  const right = clamp01((rect.x + rect.w) / w);
  const bottom = clamp01((rect.y + rect.h) / h);
  return { x, y, w: clamp01(right - x), h: clamp01(bottom - y) };
}

export function makeIssue(input: {
  ruleId: string;
  severity: Severity;
  page: number | null;
  bbox?: Bbox;
  message: string;
  evidence?: string;
  suggestedFix?: string;
  confidence?: 'confirmed' | 'suspected';
}): Issue {
  return {
    id: issueId(input.ruleId, input.page, input.bbox),
    ruleId: input.ruleId,
    severity: input.severity,
    page: input.page,
    ...(input.bbox ? { bbox: input.bbox } : {}),
    message: input.message,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.suggestedFix ? { suggestedFix: input.suggestedFix } : {}),
    confidence: input.confidence ?? 'confirmed',
  };
}

/** Status derivation: confirmed blocking/major fails only when the check is required. */
export function statusOf(issues: Issue[], required: boolean): CheckStatus {
  if (issues.length === 0) return 'PASS';
  const confirmed = issues.filter((i) => i.confidence === 'confirmed');
  const severe = confirmed.filter((i) => i.severity === 'blocking' || i.severity === 'major');
  if (required && severe.length > 0) return 'FAIL';
  if (severe.length > 0 || issues.some((i) => i.severity !== 'info')) return 'REVIEW';
  return 'PASS';
}

export function check(input: {
  checkId: string;
  ruleIds: string[];
  required: boolean;
  issues: Issue[];
  summary: string;
  metrics?: Record<string, number | string>;
  limitations?: string[];
}): CheckResult {
  return {
    checkId: input.checkId,
    ruleIds: input.ruleIds,
    status: statusOf(input.issues, input.required),
    required: input.required,
    summary: input.summary,
    issues: input.issues,
    ...(input.metrics ? { metrics: input.metrics } : {}),
    ...(input.limitations ? { limitations: input.limitations } : {}),
  };
}

export function skipped(input: {
  checkId: string;
  ruleIds: string[];
  required: boolean;
  summary: string;
  reason: CheckResult['skipReason'];
  limitations?: string[];
}): CheckResult {
  return {
    checkId: input.checkId,
    ruleIds: input.ruleIds,
    status: 'SKIPPED',
    required: input.required,
    summary: input.summary,
    issues: [],
    ...(input.reason ? { skipReason: input.reason } : {}),
    ...(input.limitations ? { limitations: input.limitations } : {}),
  };
}

export function unverified(input: {
  checkId: string;
  ruleIds: string[];
  required: boolean;
  summary: string;
  limitations?: string[];
}): CheckResult {
  return {
    checkId: input.checkId,
    ruleIds: input.ruleIds,
    status: 'UNVERIFIED',
    required: input.required,
    summary: input.summary,
    issues: [],
    ...(input.limitations ? { limitations: input.limitations } : {}),
  };
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Vertical overlap fraction relative to the smaller height. */
export function vOverlap(a: Rect, b: Rect): number {
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const min = Math.min(a.h, b.h);
  return min > 0 ? Math.max(0, h) / min : 0;
}
