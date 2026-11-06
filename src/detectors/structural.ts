import type { CheckResult, Limits } from '../core/types.js';
import type { OpenedDocument } from '../engine/types.js';
import { check, makeIssue, skipped, unverified } from './common.js';

const MIN_SIDE = 72; // 1 inch; below this a page is almost certainly broken
const MAX_SIDE = 14400; // 200 inches
const MAX_MIX_RATIO = 1.3;

export interface StructuralContext {
  limits: Limits;
  enabled: (ruleId: string) => boolean;
}

export function runStructural(doc: OpenedDocument, ctx: StructuralContext): CheckResult[] {
  const out: CheckResult[] = [];

  if (ctx.enabled('pdf.structure.page-box')) {
    const issues = [];
    const sizes = new Map<string, number>();
    for (const page of doc.pages) {
      const { width, height } = page;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        issues.push(
          makeIssue({
            ruleId: 'pdf.structure.page-box',
            severity: 'major',
            page: page.pageNumber,
            message: `Page ${page.pageNumber} has an invalid page box (${width}×${height}pt).`,
            evidence: `width=${width}, height=${height}`,
            suggestedFix: 'Regenerate the page with an explicit, positive page size.',
          }),
        );
        continue;
      }
      const key = `${Math.round(width)}x${Math.round(height)}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
      if (width < MIN_SIDE || height < MIN_SIDE || width > MAX_SIDE || height > MAX_SIDE) {
        issues.push(
          makeIssue({
            ruleId: 'pdf.structure.page-box',
            severity: 'major',
            page: page.pageNumber,
            message: `Page ${page.pageNumber} size ${Math.round(width)}×${Math.round(height)}pt is outside the plausible range.`,
            evidence: `allowed ${MIN_SIDE}–${MAX_SIDE}pt per side`,
          }),
        );
      }
    }
    if (sizes.size > 1) {
      const sorted = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
      const [commonKey, commonCount] = sorted[0]!;
      const [cw, ch] = commonKey.split('x').map(Number) as [number, number];
      for (const page of doc.pages) {
        const ratio = Math.max(page.width / cw, page.height / ch, cw / page.width, ch / page.height);
        if (ratio > MAX_MIX_RATIO) {
          issues.push(
            makeIssue({
              ruleId: 'pdf.structure.page-box',
              severity: 'minor',
              page: page.pageNumber,
              message: `Page ${page.pageNumber} deviates from the document's dominant page size (${commonKey}pt).`,
              evidence: `page ${Math.round(page.width)}×${Math.round(page.height)}pt; ${commonCount}/${doc.pages.length} pages use ${commonKey}pt`,
              confidence: 'suspected',
            }),
          );
        }
      }
    }
    out.push(
      check({
        checkId: 'pdf.structure.page-box',
        ruleIds: ['pdf.structure.page-box'],
        required: true,
        issues,
        summary:
          issues.length === 0
            ? `All ${doc.pages.length} pages have plausible, consistent page boxes.`
            : `${issues.length} page-box problem(s) found.`,
        metrics: { pages: doc.pages.length, distinctSizes: sizes.size },
      }),
    );
  }

  if (ctx.enabled('pdf.structure.blank-page')) {
    const issues = [];
    const blanks: number[] = [];
    for (const page of doc.pages) {
      const chars = page.runs.reduce((n, r) => n + r.str.trim().length, 0);
      if (chars < 5 && page.drawings.length === 0 && page.images.length === 0) {
        blanks.push(page.pageNumber);
        issues.push(
          makeIssue({
            ruleId: 'pdf.structure.blank-page',
            severity: 'minor',
            page: page.pageNumber,
            message: `Page ${page.pageNumber} appears blank (no text and no graphics).`,
            evidence: `characters=${chars}, drawings=${page.drawings.length}, images=${page.images.length}`,
            confidence: 'suspected',
            suggestedFix: 'Remove the page, or add content if it was emitted by mistake.',
          }),
        );
      }
    }
    out.push(
      check({
        checkId: 'pdf.structure.blank-page',
        ruleIds: ['pdf.structure.blank-page'],
        required: true,
        issues,
        summary: blanks.length
          ? `${blanks.length} page(s) appear blank: ${blanks.slice(0, 10).join(', ')}${blanks.length > 10 ? '…' : ''}.`
          : 'No blank pages detected.',
        metrics: { blankPages: blanks.length },
        limitations: ['Intentional section dividers can legitimately be blank; such hits are reported as suspected.'],
      }),
    );
  }

  if (ctx.enabled('pdf.structure.text-layer')) {
    const total = doc.pages.reduce((n, p) => n + p.runs.length, 0);
    const chars = doc.pages.reduce((n, p) => n + p.runs.reduce((m, r) => m + r.str.length, 0), 0);
    if (total === 0) {
      out.push(
        unverified({
          checkId: 'pdf.structure.text-layer',
          ruleIds: ['pdf.structure.text-layer'],
          required: true,
          summary: 'The document has no extractable text layer (scanned or image-only PDF).',
          limitations: [
            'Text-based content checks cannot run on this document; they are reported as UNVERIFIED, not as failures.',
          ],
        }),
      );
    } else {
      out.push(
        check({
          checkId: 'pdf.structure.text-layer',
          ruleIds: ['pdf.structure.text-layer'],
          required: true,
          issues: [],
          summary: `Extracted ${chars.toLocaleString('en-US')} characters from ${total.toLocaleString('en-US')} text items.`,
          metrics: { textItems: total, characters: chars },
        }),
      );
    }
  }

  if (ctx.enabled('pdf.structure.font-embedding')) {
    out.push(
      skipped({
        checkId: 'pdf.structure.font-embedding',
        ruleIds: ['pdf.structure.font-embedding'],
        required: false,
        summary: 'Font embedding inspection is not implemented in V0.1.',
        reason: 'not-applicable',
        limitations: ['The engine does not expose font descriptors yet; missing embedded fonts can still render incorrectly.'],
      }),
    );
  }

  return out;
}
