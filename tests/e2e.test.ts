import { describe, expect, it } from './harness.js';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CONTRACT, drawText, makePdf, writeContract } from './fixtures.js';
import { verify } from '../src/verification/run.js';
import { normalizeContract } from '../src/core/contract.js';
import { parseCommandInput, toolDefinition } from '../src/adapter/harness.js';

const run = (path: string, contract?: unknown, extra: Record<string, unknown> = {}) =>
  verify({
    artifactPath: path,
    ...(contract ? { contract: normalizeContract(contract) } : {}),
    writeReports: false,
    ...extra,
  });

describe('end-to-end verification', () => {
  it('passes a document that satisfies its contract', async () => {
    const pdf = await makePdf('good', (page, font) => {
      drawText(page, font, 'Section One', 72, 760, 20);
      drawText(page, font, 'hello world', 72, 700, 12);
    });
    const result = await run(
      pdf.path,
      CONTRACT([
        { kind: 'section', value: 'Section One', severity: 'blocking' },
        { kind: 'phrase', value: 'hello world', severity: 'major' },
      ]),
    );
    expect(result.report.status).toBe('PASS');
    expect(result.report.issues).toHaveLength(0);
  });

  it('fails when a required section is missing', async () => {
    const pdf = await makePdf('missing', (page, font) => {
      drawText(page, font, 'Section One', 72, 760, 20);
    });
    const result = await run(
      pdf.path,
      CONTRACT([{ kind: 'section', value: 'Section Two', severity: 'blocking' }]),
    );
    expect(result.report.status).toBe('FAIL');
    expect(result.report.issues[0]?.ruleId).toBe('pdf.content.section-presence');
  });

  it('fails on two different text runs drawn at the same position', async () => {
    const pdf = await makePdf('overlap', (page, font) => {
      drawText(page, font, 'AAAAAA', 72, 700, 14);
      drawText(page, font, 'BBBBBB', 72, 700, 14);
    });
    const result = await run(pdf.path);
    const overlap = result.report.issues.find((i) => i.ruleId === 'pdf.layout.text-overlap');
    expect(overlap?.confidence).toBe('confirmed');
    expect(result.report.status).toBe('FAIL');
  });

  it('reports an image-only PDF as REVIEW, never FAIL, for content', async () => {
    const pdf = await makePdf('scanned', (page) => {
      page.drawRectangle({ x: 72, y: 600, width: 200, height: 100 });
    });
    const result = await run(
      pdf.path,
      CONTRACT([{ kind: 'phrase', value: 'hello world', severity: 'blocking' }]),
    );
    expect(result.report.status).toBe('REVIEW');
    const content = result.report.checks.find((c) => c.checkId === 'pdf.content.phrase-presence');
    expect(content?.status).toBe('UNVERIFIED');
  });

  it('returns ERROR for a corrupt PDF body', async () => {
    const pdf = await makePdf('broken', (page, font) => {
      drawText(page, font, 'x', 72, 700, 12);
    });
    const broken = join(pdf.dir, 'broken.pdf');
    await writeFile(broken, '%PDF-1.7\nthis is not a real pdf body', 'latin1');
    const result = await run(broken);
    expect(result.report.status).toBe('ERROR');
    expect(result.report.checks[0]?.checkId).toBe('pdf.structure.file-type');
    expect(result.report.checks.some((c) => c.status === 'ERROR')).toBe(true);
  });

  it('cannot PASS without a contract', async () => {
    const pdf = await makePdf('nocontract', (page, font) => {
      drawText(page, font, 'Some body text', 72, 700, 12);
    });
    const result = await run(pdf.path);
    expect(result.report.status).toBe('REVIEW');
    expect(result.report.checks.find((c) => c.checkId === 'contract.confirmed')?.status).toBe('UNVERIFIED');
    expect(result.report.contract.confirmed).toBe(false);
  });

  it('lists user-disabled checks as SKIPPED', async () => {
    const pdf = await makePdf('disabled', (page, font) => {
      drawText(page, font, 'Some body text', 72, 700, 12);
    });
    const result = await run(pdf.path, CONTRACT([]), {
      disabledChecks: ['pdf.layout.text-overlap'],
    });
    const skipped = result.report.checks.find((c) => c.checkId === 'pdf.layout.text-overlap');
    expect(skipped?.status).toBe('SKIPPED');
    expect(skipped?.required).toBe(false);
  });

  it('reads a contract file and hashes it deterministically', async () => {
    const pdf = await makePdf('filecontract', (page, font) => {
      drawText(page, font, 'Section One', 72, 760, 20);
    });
    const contractPath = await writeContract(pdf.dir, CONTRACT([{ kind: 'section', value: 'Section One' }]));
    const a = await verify({ artifactPath: pdf.path, contractPath, writeReports: false });
    const b = await verify({ artifactPath: pdf.path, contractPath, writeReports: false });
    expect(a.report.status).toBe('PASS');
    expect(a.report.contract.hash).toBe(b.report.contract.hash);
    expect(a.report.reportId).not.toBe(b.report.reportId);
  });

  it('returns a lossless JSON value from the tool adapter', async () => {
    const pdf = await makePdf('tooljson', (page, font) => {
      drawText(page, font, 'hello world', 72, 700, 12);
    });
    const tool = toolDefinition({
      workspaceRoot: pdf.dir,
      outDir: '',
      maxBytes: 100 * 1024 * 1024,
      maxPages: 300,
      timeoutMs: 180_000,
      restrictToWorkspace: true,
    });
    const value = (await tool.execute({ path: basename(pdf.path) }, {})) as Record<string, unknown>;
    expect(value.status).toBe('REVIEW');
    expect(hasUndefined(value)).toBe(false);
  });

  it('refuses a link that escapes the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'doneright-ws-'));
    const outside = await mkdtemp(join(tmpdir(), 'doneright-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const tool = toolDefinition({
      workspaceRoot: workspace,
      outDir: '',
      maxBytes: 100 * 1024 * 1024,
      maxPages: 300,
      timeoutMs: 180_000,
      restrictToWorkspace: true,
    });
    let message = '';
    try {
      await tool.execute({ path: 'escape/secret.txt' }, {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('outside the workspace');
  });

  it('rejects an oversized artifact without reading it', async () => {
    const pdf = await makePdf('big', (page, font) => {
      drawText(page, font, 'x', 72, 700, 12);
    });
    const result = await run(pdf.path, undefined, { limits: { maxBytes: 8 } });
    expect(result.report.status).toBe('ERROR');
    expect(result.report.checks[0]?.checkId).toBe('pdf.limits.file-size');
    expect(result.report.artifact.sha256).toBe('');
  });

  it('refuses to write reports outside the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'doneright-ws2-'));
    const outside = await mkdtemp(join(tmpdir(), 'doneright-out2-'));
    await writeFile(join(workspace, 'x.pdf'), '%PDF-1.4\n', 'latin1');
    const tool = toolDefinition({
      workspaceRoot: workspace,
      outDir: '',
      maxBytes: 100 * 1024 * 1024,
      maxPages: 300,
      timeoutMs: 180_000,
      restrictToWorkspace: true,
    });
    let message = '';
    try {
      await tool.execute({ path: 'x.pdf', outDir: outside }, {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('outside the workspace');
  });

  it('reports a missing --contract value', () => {
    expect(parseCommandInput('x.pdf --contract').error).toBe('--contract requires a file path.');
    expect(parseCommandInput('x.pdf --contract --strict').error).toBe('--contract requires a file path.');
    expect(parseCommandInput('x.pdf --contract c.json').contract).toBe('c.json');
  });
});

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => item === undefined || hasUndefined(item),
    );
  }
  return false;
}
