import type { CheckResult, Issue } from '../core/types.js';
import type { OpenedDocument, PageInfo, Rect, TextRun } from '../engine/types.js';
import { check, intersection, makeIssue, rectArea, skipped, toBbox, vOverlap } from './common.js';

const OVERFLOW_TOL_PT = 2;
const OVERFLOW_FAIL_RATIO = 0.2;
const OVERFLOW_SUSPECT_RATIO = 0.95;
const OVERLAP_CONFIRM = 0.35;
const OVERLAP_SUSPECT = 0.15;
const V_OVERLAP_CONFIRM = 0.5;
// Absolute overlap required in each axis: keeps kerning pairs and punctuation
// from being reported as collisions while still catching stacked runs.
const OVERLAP_MIN_X_PT = 1.25;
const OVERLAP_MIN_Y_PT = 0.8;
const MAX_ISSUES = 50;

export interface LayoutContext {
  enabled: (ruleId: string) => boolean;
}

export function runLayout(doc: OpenedDocument, ctx: LayoutContext): CheckResult[] {
  const out: CheckResult[] = [];
  if (ctx.enabled('pdf.layout.page-overflow')) out.push(overflowCheck(doc));
  if (ctx.enabled('pdf.layout.text-overlap')) out.push(overlapCheck(doc));
  if (ctx.enabled('pdf.layout.edge-proximity')) out.push(edgeCheck(doc));
  if (ctx.enabled('pdf.layout.table-overflow')) {
    out.push(
      skipped({
        checkId: 'pdf.layout.table-overflow',
        ruleIds: ['pdf.layout.table-overflow'],
        required: false,
        summary: 'Table structure is not modelled in V0.1, so cell overflow cannot be verified.',
        reason: 'not-applicable',
        limitations: [
          'Detecting table cell overflow requires reconstructing table geometry from drawing operators; V0.1 reports this as SKIPPED rather than guessing.',
        ],
      }),
    );
  }
  if (ctx.enabled('pdf.layout.image-overlap')) {
    const images = doc.pages.flatMap((p) => p.images.map((img) => ({ page: p, rect: img.rect })));
    if (images.length === 0) {
      out.push(
        skipped({
          checkId: 'pdf.layout.image-overlap',
          ruleIds: ['pdf.layout.image-overlap'],
          required: false,
          summary: 'No raster images were extracted from this document.',
          reason: 'not-applicable',
        }),
      );
    } else {
      out.push(imageOverlapCheck(doc));
    }
  }
  return out;
}

function overflowCheck(doc: OpenedDocument): CheckResult {
  const issues: Issue[] = [];
  let maxRatio = 0;
  let considered = 0;
  for (const page of doc.pages) {
    for (const run of page.runs) {
      if (run.str.trim().length === 0) continue;
      considered++;
      const over = overflowRect(run.rect, page);
      if (!over) continue;
      const area = rectArea(run.rect);
      if (area <= 0) continue;
      const ratio = Math.min(1, rectArea(over) / area);
      maxRatio = Math.max(maxRatio, ratio);
      if (issues.length >= MAX_ISSUES) continue;
      const clipped = clipText(run.str);
      const local = issues.length >= MAX_ISSUES;
      if (ratio > OVERFLOW_SUSPECT_RATIO) {
        issues.push(
          makeIssue({
            ruleId: 'pdf.layout.page-overflow',
            severity: 'minor',
            page: page.pageNumber,
            bbox: toBbox(run.rect, page),
            message: `Text "${clipped}" lies almost entirely outside the page box.`,
            evidence: `overflow ratio ${(ratio * 100).toFixed(0)}%`,
            confidence: 'suspected',
            suggestedFix: 'Check for text emitted outside the CropBox or with a negative offset.',
          }),
        );
      } else if (ratio > OVERFLOW_FAIL_RATIO && !local) {
        issues.push(
          makeIssue({
            ruleId: 'pdf.layout.page-overflow',
            severity: 'major',
            page: page.pageNumber,
            bbox: toBbox(run.rect, page),
            message: `Text "${clipped}" overflows the page boundary by ${(ratio * 100).toFixed(0)}% of its box.`,
            evidence: `rect ${fmt(run.rect)} outside ${Math.round(page.width)}×${Math.round(page.height)}pt`,
            suggestedFix: 'Wrap or move the text so it fits inside the printable area.',
          }),
        );
      } else if (!local) {
        issues.push(
          makeIssue({
            ruleId: 'pdf.layout.page-overflow',
            severity: 'minor',
            page: page.pageNumber,
            bbox: toBbox(run.rect, page),
            message: `Text "${clipped}" slightly exceeds the page boundary (${(ratio * 100).toFixed(1)}%).`,
            evidence: `rect ${fmt(run.rect)}`,
            confidence: 'suspected',
          }),
        );
      }
    }
  }
  return check({
    checkId: 'pdf.layout.page-overflow',
    ruleIds: ['pdf.layout.page-overflow'],
    required: true,
    issues,
    summary: issues.length
      ? `${issues.length} text run(s) extend beyond the page boundary (largest overflow ${(maxRatio * 100).toFixed(0)}%).`
      : `No text overflows the page boundary (${considered} runs checked).`,
    metrics: { runsChecked: considered, maxOverflowRatio: Number(maxRatio.toFixed(3)) },
    limitations: [
      'Runs wholly outside the CropBox may be intentional printer marks; they are reported as suspected.',
      'The PDF engine clips text at the page edge, so text drawn entirely outside the page may not be visible to this check.',
    ],
  });
}

function overflowRect(rect: Rect, page: PageInfo): Rect | null {
  const left = Math.min(0, rect.x) * -1;
  const top = Math.min(0, rect.y) * -1;
  const right = rect.x + rect.w - page.width;
  const bottom = rect.y + rect.h - page.height;
  const dx = Math.max(left, right);
  const dy = Math.max(top, bottom);
  if (dx <= OVERFLOW_TOL_PT && dy <= OVERFLOW_TOL_PT) return null;
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const x2 = Math.min(page.width, rect.x + rect.w);
  const y2 = Math.min(page.height, rect.y + rect.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

function overlapCheck(doc: OpenedDocument): CheckResult {
  const issues: Issue[] = [];
  let pairs = 0;
  let linesTotal = 0;
  for (const page of doc.pages) {
    const lines = groupLines(page.runs);
    linesTotal += lines.length;
    const runs = page.runs.filter((r) => r.str.trim().length > 0 && r.rect.w > 0 && r.rect.h > 0);
    for (let i = 0; i < runs.length; i++) {
      const a = runs[i]!;
      for (let j = i + 1; j < runs.length; j++) {
        if (issues.length >= MAX_ISSUES) break;
        const b = runs[j]!;
        const vo = vOverlap(a.rect, b.rect);
        if (vo < 0.3) continue;
        const inter = intersection(a.rect, b.rect);
        const minArea = Math.min(rectArea(a.rect), rectArea(b.rect));
        if (minArea <= 0) continue;
        const ratio = inter / minArea;
        if (ratio < OVERLAP_SUSPECT) continue;
        // A comma or kerning pair can sit a fraction of a point inside the
        // previous run's advance box. Require a real two-dimensional bite
        // before calling it a collision.
        const ix = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
        const iy = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
        if (ix < OVERLAP_MIN_X_PT || iy < OVERLAP_MIN_Y_PT) continue;
        pairs++;
        const sameText = a.str.trim() === b.str.trim();
        // The same string drawn twice at the same spot is a text-shadow trick, not a collision.
        if (sameText && Math.abs(a.rect.x - b.rect.x) < 0.3 && Math.abs(a.rect.y - b.rect.y) < 0.3) continue;
        if (ratio >= OVERLAP_CONFIRM && vo >= V_OVERLAP_CONFIRM) {
          issues.push(
            makeIssue({
              ruleId: 'pdf.layout.text-overlap',
              severity: 'major',
              page: page.pageNumber,
              bbox: toBbox(a.rect, page),
              message: `Two text runs overlap by ${(ratio * 100).toFixed(0)}%: "${clipText(a.str)}" / "${clipText(b.str)}".`,
              evidence: `vertical overlap ${(vo * 100).toFixed(0)}%; boxes ${fmt(a.rect)} and ${fmt(b.rect)}`,
              suggestedFix: 'Adjust line height, wrapping, or absolute positions so the runs no longer collide.',
            }),
          );
        } else {
          issues.push(
            makeIssue({
              ruleId: 'pdf.layout.text-overlap',
              severity: 'minor',
              page: page.pageNumber,
              bbox: toBbox(a.rect, page),
              message: `Possible text overlap (${(ratio * 100).toFixed(0)}% of the smaller run): "${clipText(a.str)}" / "${clipText(b.str)}".`,
              evidence: `vertical overlap ${(vo * 100).toFixed(0)}%`,
              confidence: 'suspected',
            }),
          );
        }
      }
    }
  }
  return check({
    checkId: 'pdf.layout.text-overlap',
    ruleIds: ['pdf.layout.text-overlap'],
    required: true,
    issues,
    summary: issues.length
      ? `${issues.length} overlapping text run pair(s) found across ${linesTotal} lines.`
      : `No text run overlaps found across ${linesTotal} lines.`,
    metrics: { lines: linesTotal, candidatePairs: pairs },
    limitations: [
      'Runs sharing a visual line are treated as one line, so kerning and ligatures inside a line never count as overlap.',
    ],
  });
}

function edgeCheck(doc: OpenedDocument): CheckResult {
  const issues: Issue[] = [];
  let tight = 0;
  for (const page of doc.pages) {
    const margin = 4;
    for (const run of page.runs) {
      if (run.rect.w < page.width * 0.2) continue;
      const gaps = [
        run.rect.x,
        run.rect.y,
        page.width - (run.rect.x + run.rect.w),
        page.height - (run.rect.y + run.rect.h),
      ];
      const near = Math.min(...gaps);
      if (near < 0 || near >= margin) continue;
      tight++;
      if (issues.length >= MAX_ISSUES) continue;
      issues.push(
        makeIssue({
          ruleId: 'pdf.layout.edge-proximity',
          severity: 'minor',
          page: page.pageNumber,
          bbox: toBbox(run.rect, page),
          message: `Wide text line sits ${near.toFixed(1)}pt from the page edge.`,
          evidence: `"${clipText(run.str)}"`,
          confidence: 'suspected',
          suggestedFix: 'Increase the page margin if the text is at risk of being clipped when printed.',
        }),
      );
    }
  }
  return check({
    checkId: 'pdf.layout.edge-proximity',
    ruleIds: ['pdf.layout.edge-proximity'],
    required: false,
    issues,
    summary: tight ? `${tight} wide text line(s) close to the page edge.` : 'No wide text lines crowd the page edge.',
    metrics: { tightLines: tight },
    limitations: ['Full-bleed layouts are legitimate; this check is heuristic and optional.'],
  });
}

interface Line {
  band: Rect;
  text: string;
  runs: TextRun[];
}

function groupLines(runs: TextRun[]): Line[] {
  const usable = runs.filter((r) => r.str.trim().length > 0 && r.rect.w > 0 && r.rect.h > 0);
  const sorted = [...usable].sort((a, b) => a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2));
  const out: Line[] = [];
  const buckets: Array<{ cy: number; runs: TextRun[] }> = [];
  for (const run of sorted) {
    const cy = run.rect.y + run.rect.h / 2;
    const last = buckets[buckets.length - 1];
    if (last && Math.abs(cy - last.cy) <= Math.max(1, 0.5 * run.rect.h)) {
      last.runs.push(run);
    } else {
      buckets.push({ cy, runs: [run] });
    }
  }
  for (const bucket of buckets) {
    const band = bucket.runs.reduce<Rect>(
      (acc, r) => {
        const x = Math.min(acc.x, r.rect.x);
        const y = Math.min(acc.y, r.rect.y);
        const x2 = Math.max(acc.x + acc.w, r.rect.x + r.rect.w);
        const y2 = Math.max(acc.y + acc.h, r.rect.y + r.rect.h);
        return { x, y, w: x2 - x, h: y2 - y };
      },
      { ...bucket.runs[0]!.rect },
    );
    const text = bucket.runs
      .slice()
      .sort((a, b) => a.rect.x - b.rect.x)
      .map((r) => r.str)
      .join(' ');
    out.push({ band, text, runs: bucket.runs });
  }
  return out;
}

function imageOverlapCheck(doc: OpenedDocument): CheckResult {
  const issues: Issue[] = [];
  for (const page of doc.pages) {
    for (const img of page.images) {
      const covered = page.runs.filter((r) => {
        if (r.str.trim().length === 0) return false;
        const inter = intersection(img.rect, r.rect);
        return rectArea(r.rect) > 0 && inter / rectArea(r.rect) >= 0.9;
      });
      if (!covered.length) continue;
      issues.push(
        makeIssue({
          ruleId: 'pdf.layout.image-overlap',
          severity: 'minor',
          page: page.pageNumber,
          bbox: toBbox(img.rect, page),
          message: `An image covers ${covered.length} text run(s); text may be unreadable.`,
          evidence: `"${clipText(covered[0]!.str)}"`,
          confidence: 'suspected',
          suggestedFix: 'Move the image or add a caption background so the text remains legible.',
        }),
      );
    }
  }
  return check({
    checkId: 'pdf.layout.image-overlap',
    ruleIds: ['pdf.layout.image-overlap'],
    required: false,
    issues,
    summary: issues.length ? `${issues.length} image/text overlap(s) detected.` : 'No image covers extracted text.',
  });
}

function clipText(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function fmt(r: Rect): string {
  return `[${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.w.toFixed(1)}×${r.h.toFixed(1)}]`;
}
