import type { CheckResult } from '../core/types.js';

/** Visual review is P1. Until a vision provider is configured, it must never pretend to have run. */
export function runVisual(enabled: boolean): CheckResult[] {
  if (!enabled) return [];
  return [
    {
      checkId: 'pdf.visual.review',
      ruleIds: ['pdf.visual.review'],
      status: 'SKIPPED',
      required: false,
      summary: 'Visual review requires a configured vision model; none is set in V0.1.',
      issues: [],
      skipReason: 'not-applicable',
      limitations: [
        'No page was rendered to an image. Layout verdicts above come only from geometric checks, not from looking at the page.',
      ],
    },
  ];
}
