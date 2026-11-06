import { assemblePageText, normalizeText, stripRunningHeaders } from '../core/normalize.js';
import { bestChunkMatch } from '../core/match.js';
import type { CheckResult, Contract, Issue, Requirement, Severity } from '../core/types.js';
import type { OpenedDocument } from '../engine/types.js';
import { check, makeIssue, unverified } from './common.js';

const FUZZY_EXACT_MAX = 40;

export interface ContentContext {
  contract: Contract;
  sources: string[];
  enabled: (ruleId: string) => boolean;
}

export function runContent(doc: OpenedDocument, ctx: ContentContext): CheckResult[] {
  const { contract } = ctx;
  const reqs = contract.requirements;
  const out: CheckResult[] = [];

  const pages = doc.pages.map((p) => assemblePageText(p.runs).text);
  const strip =
    contract.options?.stripRunningHeaders !== false && reqs.some((r) => r.kind === 'section' || r.kind === 'phrase');
  const { pages: bodyPages } = strip ? stripRunningHeaders(pages) : { pages };

  const hasText = bodyPages.some((p) => p.trim().length > 0);
  const full = bodyPages.join('\n');
  const norm = (s: string, caseSensitive = false) => normalizeText(s, caseSensitive);
  const normFull = norm(full);
  const rawFull = norm(full, true);

  const byKind = (kind: Requirement['kind']) => reqs.filter((r) => r.kind === kind);

  if (ctx.enabled('pdf.content.section-presence')) {
    const list = [...byKind('section'), ...byKind('heading')];
    const ruleId = 'pdf.content.section-presence';
    if (!list.length) {
      out.push(empty(ruleId, 'No section or heading requirements in the contract.'));
    } else if (!hasText) {
      out.push(
        unverified({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          summary: 'Section/heading requirements cannot be verified: the document has no text layer.',
          limitations: ['Scanned PDFs need OCR before content checks can run.'],
        }),
      );
    } else {
      const strict = contract.options?.strictHeadings === true;
      const issues: Issue[] = [];
      let found = 0;
      for (const req of list) {
        const value = req.value ?? '';
        if (!value) continue;
        const needle = norm(value, req.caseSensitive);
        const hay = req.caseSensitive ? rawFull : normFull;
        const present = strict ? hasLineStartingWith(hay, needle) : hay.includes(needle);
        if (present) {
          found++;
          continue;
        }
        issues.push(missingIssue(req, `Section/heading "${value}" was not found in the document text.`, 'Add the section, or correct its title if it was renamed.'));
      }
      out.push(
        check({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          issues,
          summary: issues.length
            ? `${issues.length}/${list.length} required section/heading item(s) missing.`
            : `All ${list.length} section/heading requirement(s) found.`,
          metrics: { required: list.length, found },
          limitations: strict
            ? ['Heading matching requires the heading to start a line after normalization.']
            : ['Headings are matched as substrings; a mention in body text also satisfies the requirement.'],
        }),
      );
    }
  }

  if (ctx.enabled('pdf.content.phrase-presence')) {
    const ruleId = 'pdf.content.phrase-presence';
    const list = byKind('phrase');
    if (!list.length) {
      out.push(empty(ruleId, 'No phrase requirements in the contract.'));
    } else if (!hasText) {
      out.push(
        unverified({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          summary: 'Phrase requirements cannot be verified: the document has no text layer.',
          limitations: ['Scanned PDFs need OCR before content checks can run.'],
        }),
      );
    } else {
      const pass = contract.options?.fuzzyPass ?? 0.92;
      const review = contract.options?.fuzzyReview ?? 0.8;
      const issues: Issue[] = [];
      let exact = 0;
      let fuzzy = 0;
      for (const req of list) {
        const value = req.value ?? '';
        if (!value) continue;
        const needle = norm(value, req.caseSensitive);
        const hay = req.caseSensitive ? rawFull : normFull;
        if (hay.includes(needle)) {
          exact++;
          continue;
        }
        if (needle.length > FUZZY_EXACT_MAX) {
          const hit = bestChunkMatch(needle, hay);
          if (hit.score >= pass) {
            fuzzy++;
            continue;
          }
          if (hit.score >= review) {
            fuzzy++;
            issues.push(
              makeIssue({
                ruleId,
                severity: req.severity === 'blocking' ? 'major' : 'minor',
                page: null,
                message: `Phrase "${clip(value)}" only fuzzy-matches (${(hit.score * 100).toFixed(0)}% similar).`,
                evidence: hit.snippet,
                confidence: 'suspected',
                suggestedFix: 'Confirm the wording manually; a near-match may be a paraphrase rather than the required text.',
              }),
            );
            continue;
          }
        }
        issues.push(missingIssue(req, `Phrase "${clip(value)}" was not found in the document text.`, 'Restore the required wording.'));
      }
      out.push(
        check({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          issues,
          summary: issues.length
            ? `${issues.length}/${list.length} phrase requirement(s) not verifiably present.`
            : `All ${list.length} phrase requirement(s) present (${exact} exact, ${fuzzy} fuzzy).`,
          metrics: { required: list.length, exact, fuzzy },
          limitations: [
            `Phrases longer than ${FUZZY_EXACT_MAX} characters may match fuzzily (pass ≥ ${pass}, review ≥ ${review}).`,
          ],
        }),
      );
    }
  }

  if (ctx.enabled('pdf.content.prohibited-presence')) {
    const ruleId = 'pdf.content.prohibited-presence';
    const list = byKind('prohibited');
    if (!list.length) {
      out.push(empty(ruleId, 'No prohibited-content requirements in the contract.'));
    } else if (!hasText) {
      out.push(
        unverified({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          summary: 'Prohibited-content requirements cannot be verified: the document has no text layer.',
        }),
      );
    } else {
      const issues: Issue[] = [];
      for (const req of list) {
        const value = req.value ?? '';
        if (!value) continue;
        const needle = norm(value, req.caseSensitive);
        const hay = req.caseSensitive ? rawFull : normFull;
        const idx = hay.indexOf(needle);
        if (idx < 0) continue;
        const page = locatePage(bodyPages, norm, needle, req.caseSensitive);
        issues.push(
          makeIssue({
            ruleId,
            severity: req.severity,
            page,
            message: `Prohibited text "${clip(value)}" appears in the document.`,
            evidence: hay.slice(Math.max(0, idx - 40), idx + needle.length + 40),
            suggestedFix: 'Remove the prohibited text, or revise the contract if it is now allowed.',
          }),
        );
      }
      out.push(
        check({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          issues,
          summary: issues.length
            ? `${issues.length} prohibited text match(es) found.`
            : `No prohibited text found (${list.length} rule(s)).`,
        }),
      );
    }
  }

  if (ctx.enabled('pdf.content.order')) {
    const ruleId = 'pdf.content.order';
    const list = byKind('order');
    if (!list.length) {
      out.push(empty(ruleId, 'No ordering requirements in the contract.'));
    } else if (!hasText) {
      out.push(
        unverified({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          summary: 'Ordering requirements cannot be verified: the document has no text layer.',
        }),
      );
    } else {
      const issues: Issue[] = [];
      for (const req of list) {
        const values = req.values ?? [];
        let cursor = 0;
        let failed = false;
        for (const value of values) {
          const needle = norm(value, req.caseSensitive);
          const idx = normFull.indexOf(needle, cursor);
          if (idx < 0) {
            failed = true;
            issues.push(
              makeIssue({
                ruleId,
                severity: req.severity,
                page: null,
                message: `Ordered item "${clip(value)}" is missing, so the required order cannot be satisfied.`,
                evidence: `expected order: ${values.map(clip).join(' → ')}`,
              }),
            );
            break;
          }
          cursor = idx + needle.length;
        }
        if (!failed) continue;
      }
      out.push(
        check({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          issues,
          summary: issues.length ? 'At least one ordered sequence is not satisfied.' : 'All ordered sequences appear in order.',
        }),
      );
    }
  }

  if (ctx.enabled('pdf.content.page-count')) {
    const ruleId = 'pdf.content.page-count';
    const list = byKind('page-count');
    if (!list.length) {
      out.push(empty(ruleId, 'No page-count requirement in the contract.'));
    } else {
      const pages0 = doc.pages.length;
      const issues: Issue[] = [];
      for (const req of list) {
        const tooFew = req.min !== undefined && pages0 < req.min;
        const tooMany = req.max !== undefined && pages0 > req.max;
        if (!tooFew && !tooMany) continue;
        const range = `${req.min ?? '−∞'}–${req.max ?? '+∞'}`;
        issues.push(
          makeIssue({
            ruleId,
            severity: req.severity,
            page: null,
            message: `Document has ${pages0} pages, outside the required range ${range}.`,
            evidence: `pages=${pages0}`,
            suggestedFix: 'Regenerate the document with the required page budget.',
          }),
        );
      }
      out.push(
        check({
          checkId: ruleId,
          ruleIds: [ruleId],
          required: requiredFor(list),
          issues,
          summary: issues.length ? `Page count ${pages0} violates the contract.` : `Page count ${pages0} satisfies the contract.`,
          metrics: { pages: pages0 },
        }),
      );
    }
  }

  return out;
}

function empty(ruleId: string, summary: string): CheckResult {
  return {
    checkId: ruleId,
    ruleIds: [ruleId],
    status: 'SKIPPED',
    required: false,
    summary,
    issues: [],
    skipReason: 'not-applicable',
  };
}

function requiredFor(reqs: Requirement[]): boolean {
  return reqs.some((r) => r.severity === 'blocking' || r.severity === 'major');
}

function missingIssue(req: Requirement, message: string, fix: string): Issue {
  const severity: Severity = req.severity;
  return makeIssue({
    ruleId: req.kind === 'section' || req.kind === 'heading' ? 'pdf.content.section-presence' : 'pdf.content.phrase-presence',
    severity,
    page: null,
    message,
    evidence: `requirement ${req.id}${req.value ? `: "${clip(req.value)}"` : ''}`,
    suggestedFix: fix,
  });
}

function hasLineStartingWith(hay: string, needle: string): boolean {
  if (!needle) return false;
  return hay.split('\n').some((line) => line.trimStart().startsWith(needle));
}

function locatePage(
  pages: string[],
  norm: (s: string, caseSensitive?: boolean) => string,
  needle: string,
  caseSensitive?: boolean,
): number | null {
  for (let i = 0; i < pages.length; i++) {
    if (norm(pages[i]!, caseSensitive).includes(needle)) return i + 1;
  }
  return null;
}

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
