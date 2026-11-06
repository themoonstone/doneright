import type { CheckResult, CheckStatus, OverallStatus, Report } from './types.js';

export function isRequired(check: CheckResult): boolean {
  return check.required;
}

export function aggregateStatus(checks: CheckResult[]): OverallStatus {
  const active = checks.filter((c) => c.skipReason !== 'user-disabled');
  const required = active.filter((c) => c.required);
  if (required.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (required.some((c) => c.status === 'ERROR')) return 'ERROR';
  if (required.some((c) => c.status === 'REVIEW' || c.status === 'UNVERIFIED')) return 'REVIEW';
  if (required.length === 0) {
    // Nothing required was checked: absence of evidence is not a pass.
    return active.some((c) => c.status === 'FAIL' || c.status === 'ERROR') ? 'REVIEW' : 'REVIEW';
  }
  if (required.every((c) => c.status === 'PASS')) {
    const optionalProblems = active.filter(
      (c) => !c.required && (c.status === 'FAIL' || c.status === 'ERROR' || c.status === 'REVIEW'),
    );
    return optionalProblems.length ? 'REVIEW' : 'PASS';
  }
  return 'REVIEW';
}

export function coverageOf(checks: CheckResult[]): Report['coverage'] {
  const executed = checks.filter((c) => c.status !== 'SKIPPED').length;
  return {
    executed,
    skipped: checks.filter((c) => c.status === 'SKIPPED').length,
    unverified: checks.filter((c) => c.status === 'UNVERIFIED').length,
    failed: checks.filter((c) => c.status === 'FAIL').length,
  };
}

export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  const order: CheckStatus[] = ['ERROR', 'FAIL', 'REVIEW', 'UNVERIFIED', 'PASS', 'SKIPPED'];
  for (const s of order) if (statuses.includes(s)) return s;
  return 'SKIPPED';
}
