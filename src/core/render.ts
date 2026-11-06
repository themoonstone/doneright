import type { CheckResult, Issue, Report } from './types.js';

const ICON: Record<string, string> = {
  PASS: '✅ PASS',
  FAIL: '❌ FAIL',
  REVIEW: '⚠️ REVIEW',
  UNVERIFIED: '❔ UNVERIFIED',
  SKIPPED: '⏭️ SKIPPED',
  ERROR: '🛑 ERROR',
};

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# DoneRight acceptance report`, '');
  lines.push(`**Status: ${ICON[report.status] ?? report.status}**`, '');
  lines.push(`- Artifact: \`${report.artifact.path}\``);
  lines.push(`- Pages: ${report.artifact.pages} · Size: ${report.artifact.bytes.toLocaleString('en-US')} bytes`);
  lines.push(`- SHA-256: \`${report.artifact.sha256}\``);
  lines.push(`- Contract: \`${report.contract.hash}\`${report.contract.confirmed ? '' : ' **(unconfirmed)**'}`);
  lines.push(`- Report: \`${report.reportId}\` at ${report.createdAt}`);
  lines.push(`- Runtime: DoneRight ${report.runtime.doneright} · ${report.runtime.engine} · Node ${report.runtime.node}`, '');

  lines.push('## Checks', '');
  lines.push('| Check | Status | Required | Summary |');
  lines.push('| --- | --- | --- | --- |');
  for (const c of report.checks) {
    lines.push(`| \`${c.checkId}\` | ${ICON[c.status] ?? c.status} | ${c.required ? 'yes' : 'no'} | ${escape(c.summary)} |`);
  }
  lines.push('');

  if (report.issues.length) {
    lines.push('## Issues', '');
    lines.push('| # | Severity | Page | Rule | Message | Evidence |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    report.issues.forEach((issue, i) => {
      lines.push(
        `| ${i + 1} | ${issue.severity}${issue.confidence === 'suspected' ? ' (suspected)' : ''} | ${
          issue.page ?? '—'
        } | \`${issue.ruleId}\` | ${escape(issue.message)} | ${escape(issue.evidence ?? '')} |`,
      );
    });
    lines.push('');
  }

  if (report.diff) {
    const d = report.diff;
    lines.push('## Compared with previous report', '');
    lines.push(
      `\`${d.previousReportId}\`: ${d.resolved} resolved · ${d.persisting} persisting · ${d.new} new · ${d.regressed} regressed.`,
    );
    if (d.noImprovementStreak >= 3) {
      lines.push('', '⚠️ No improvement across 3 consecutive runs. Stop the fix/re-check loop and ask a human to intervene.');
    }
    lines.push('');
  }

  if (report.limitations.length) {
    lines.push('## Limitations', '');
    for (const l of report.limitations) lines.push(`- ${l}`);
    lines.push('');
  }

  lines.push('## What this status means', '');
  lines.push('- **PASS** — every enabled, required check actually ran and found no blocking issue.');
  lines.push('- **FAIL** — at least one required check found a confirmed, severe problem.');
  lines.push('- **REVIEW** — something needs a human, or a required requirement could not be verified.');
  lines.push('- **ERROR** — the inspection itself could not produce a valid conclusion.');
  lines.push('', 'PASS covers only the checks listed above; it does not claim the artifact is perfect.', '');
  return lines.join('\n');
}

function escape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 300);
}

export function summarizeIssues(checks: CheckResult[]): Issue[] {
  return checks.flatMap((c) => c.issues);
}
