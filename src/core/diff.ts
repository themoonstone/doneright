import type { Bbox, DiffClass, DiffSummary, Issue, IssueDiff, Report } from './types.js';

const IOU_MATCH = 0.5;

export function iou(a: Bbox, b: Bbox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Compare the previous report with the current issues.
 * `olderIds` carries issue ids from earlier runs with the same artifact and
 * contract; an issue reappearing after being resolved is classified as
 * `regressed` rather than `new`.
 */
export function diffIssues(
  previous: Report,
  current: Issue[],
  olderIds: Set<string> = new Set(),
): DiffSummary {
  const prev = previous.issues;
  const used = new Set<string>();
  const items: IssueDiff[] = [];

  for (const issue of current) {
    let match = prev.find((p) => !used.has(p.id) && p.id === issue.id);
    if (!match) {
      match = prev.find(
        (p) =>
          !used.has(p.id) &&
          p.ruleId === issue.ruleId &&
          p.page === issue.page &&
          (issue.bbox && p.bbox ? iou(p.bbox, issue.bbox) >= IOU_MATCH : !issue.bbox && !p.bbox),
      );
    }
    if (match) {
      used.add(match.id);
      const classification: DiffClass = olderIds.has(issue.id) || olderIds.has(match.id) ? 'regressed' : 'persisting';
      items.push({ issueId: issue.id, ruleId: issue.ruleId, page: issue.page, classification, previousIssueId: match.id });
    } else {
      items.push({
        issueId: issue.id,
        ruleId: issue.ruleId,
        page: issue.page,
        classification: olderIds.has(issue.id) ? 'regressed' : 'new',
      });
    }
  }
  for (const p of prev) {
    if (used.has(p.id)) continue;
    items.push({ issueId: p.id, ruleId: p.ruleId, page: p.page, classification: 'resolved' });
  }

  return {
    previousReportId: previous.reportId,
    resolved: items.filter((i) => i.classification === 'resolved').length,
    persisting: items.filter((i) => i.classification === 'persisting').length,
    new: items.filter((i) => i.classification === 'new').length,
    regressed: items.filter((i) => i.classification === 'regressed').length,
    items,
    noImprovementStreak: 0,
  };
}

/** Trailing runs of FAIL/REVIEW where confirmed issues did not drop. Capped at 3. */
export function noImprovementStreak(
  history: Array<{ status: string; confirmedIssues: number }>,
): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && streak < 3; i--) {
    const cur = history[i]!;
    if (cur.status !== 'FAIL' && cur.status !== 'REVIEW') break;
    const prev = history[i - 1];
    if (prev && cur.confirmedIssues >= prev.confirmedIssues) {
      streak++;
    } else if (!prev) {
      streak = 1;
    } else {
      break;
    }
  }
  return streak;
}
