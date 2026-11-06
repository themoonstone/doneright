import { describe, expect, it } from './harness.js';
import { aggregateStatus } from '../src/core/aggregate.js';
import { normalizeContract, defaultContract, contractConfirmed } from '../src/core/contract.js';
import { diffIssues, iou } from '../src/core/diff.js';
import { assemblePageText, normalizeText, stripRunningHeaders } from '../src/core/normalize.js';
import { bestChunkMatch, levenshtein } from '../src/core/match.js';
import { issueId, contractHash, canonicalJson } from '../src/core/ids.js';
import type { CheckResult, Issue, Report } from '../src/core/types.js';

const run = (str: string, x: number, y: number, w: number, h = 10) => ({
  str,
  rect: { x, y, w, h },
  fontSize: h,
  angle: 0,
});

describe('normalize', () => {
  it('joins runs into lines and inserts spaces for real gaps', () => {
    const { text } = assemblePageText([
      { ...run('Hello', 10, 10, 30), fontSize: 10, angle: 0 },
      { ...run('world', 50, 10, 30), fontSize: 10, angle: 0 },
      { ...run('next line', 10, 30, 50), fontSize: 10, angle: 0 },
    ] as never);
    expect(text).toBe('Hello world\nnext line');
  });

  it('dehyphenates a word split across lines', () => {
    const { text } = assemblePageText([
      { ...run('exam-', 10, 10, 30), fontSize: 10, angle: 0 },
      { ...run('ple', 10, 30, 20), fontSize: 10, angle: 0 },
    ] as never);
    expect(text).toBe('example');
  });

  it('normalizes unicode, quotes, dashes, and CJK spacing', () => {
    expect(normalizeText('Ｈｅｌｌｏ “world” — a\u200b b')).toBe('hello "world" - a b');
    expect(normalizeText('中文 字')).toBe('中文字');
    expect(normalizeText('MiXeD', true)).toBe('MiXeD');
  });

  it('strips repeated running headers', () => {
    const pages = ['Header\nbody one\n1', 'Header\nbody two\n2', 'Header\nbody three\n3'];
    const { pages: out, removed } = stripRunningHeaders(pages, { minPages: 3, ratio: 0.6 });
    expect(out[0]).toBe('body one\n1');
    expect(removed).toContain('Header');
  });
});

describe('match', () => {
  it('bounds levenshtein distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('a'.repeat(100), 'b'.repeat(100), 10)).toBeGreaterThan(10);
  });

  it('finds long phrases in wrapped text via chunk matching', () => {
    const needle = 'this is a fairly long sentence that should still be found';
    const hay = 'intro. This is a fairly long sentence that should still be found, roughly. outro';
    expect(bestChunkMatch(needle, hay.toLowerCase()).score).toBeGreaterThan(0.85);
  });
});

describe('aggregate', () => {
  const check = (status: CheckResult['status'], required = true, skipReason?: CheckResult['skipReason']): CheckResult => ({
    checkId: `c-${status}-${required}-${skipReason ?? ''}`,
    ruleIds: [],
    status,
    required,
    summary: '',
    issues: [],
    ...(skipReason ? { skipReason } : {}),
  });

  it('fails when a required check fails', () => {
    expect(aggregateStatus([check('PASS'), check('FAIL')])).toBe('FAIL');
  });

  it('prefers ERROR over REVIEW but FAIL over ERROR', () => {
    expect(aggregateStatus([check('ERROR'), check('REVIEW')])).toBe('ERROR');
    expect(aggregateStatus([check('ERROR'), check('FAIL')])).toBe('FAIL');
  });

  it('never passes when a required check is unverified or skipped for users', () => {
    expect(aggregateStatus([check('PASS'), check('UNVERIFIED')])).toBe('REVIEW');
    expect(aggregateStatus([check('PASS'), check('SKIPPED', true)])).toBe('REVIEW');
    expect(aggregateStatus([check('PASS'), check('SKIPPED', true, 'user-disabled')])).toBe('PASS');
  });

  it('lowers to REVIEW when an optional check finds a problem', () => {
    expect(aggregateStatus([check('PASS'), check('FAIL', false)])).toBe('REVIEW');
  });
});

describe('contract', () => {
  it('marks inferred requirements unconfirmed by default', () => {
    const contract = normalizeContract({
      schemaVersion: '1.0',
      contractId: 'c',
      requirements: [{ kind: 'section', value: 'S1', source: 'inferred' }],
    });
    expect(contractConfirmed(contract)).toBe(false);
  });

  it('rejects an order requirement with fewer than two values', () => {
    expect(() =>
      normalizeContract({
        schemaVersion: '1.0',
        contractId: 'c',
        requirements: [{ kind: 'order', values: ['only'] }],
      }),
    ).toThrow(/order/);
  });

  it('has a stable hash and a default contract with only file-type', () => {
    const d = defaultContract();
    expect(contractHash(d)).toBe(contractHash(defaultContract()));
    expect(d.requirements).toHaveLength(1);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('issue identity and diff', () => {
  const issue = (ruleId: string, page: number, bbox: Issue['bbox']): Issue => ({
    id: issueId(ruleId, page, bbox),
    ruleId,
    severity: 'major',
    page,
    ...(bbox ? { bbox } : {}),
    message: 'm',
    confidence: 'confirmed',
  });

  it('keeps ids stable across negligible coordinate noise', () => {
    const a = issue('r', 1, { x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    const b = issue('r', 1, { x: 0.1001, y: 0.2, w: 0.3, h: 0.1 });
    expect(a.id).toBe(b.id);
    expect(iou(a.bbox!, b.bbox!)).toBeGreaterThan(0.99);
  });

  it('classifies persisting, new, resolved, and regressed issues', () => {
    const kept = issue('r', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
    const gone = issue('r', 2, { x: 0.5, y: 0.5, w: 0.2, h: 0.1 });
    const back = issue('r', 3, { x: 0.2, y: 0.2, w: 0.2, h: 0.1 });
    const previous = {
      schemaVersion: '1.0',
      reportId: 'rpt_prev',
      issues: [kept, gone],
    } as unknown as Report;
    const summary = diffIssues(previous, [kept, back], new Set([back.id]));
    expect(summary.persisting).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.regressed).toBe(1);
    expect(summary.new).toBe(0);
  });
});
