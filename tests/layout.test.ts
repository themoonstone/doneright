import { describe, expect, it } from './harness.js';
import { runLayout } from '../src/detectors/layout.js';
import type { OpenedDocument } from '../src/engine/types.js';

const doc = (runs: OpenedDocument['pages'][number]['runs']): OpenedDocument => ({
  engineVersion: 'test',
  pages: [{ pageNumber: 1, width: 595, height: 842, rotation: 0, runs, images: [], drawings: [] }],
});

const enabled = () => true;

describe('layout geometry', () => {
  it('flags text whose box extends beyond the page', () => {
    const result = runLayout(
      doc([{ str: 'overflowing text', rect: { x: 550, y: 100, w: 100, h: 12 }, fontSize: 12, angle: 0 }]),
      { enabled },
    );
    const overflow = result.find((c) => c.checkId === 'pdf.layout.page-overflow');
    expect(overflow?.status).toBe('FAIL');
    expect(overflow?.issues[0]?.bbox?.x).toBeGreaterThan(0.9);
  });

  it('does not flag a run that just touches the edge', () => {
    const result = runLayout(
      doc([{ str: 'fits', rect: { x: 500, y: 100, w: 94, h: 12 }, fontSize: 12, angle: 0 }]),
      { enabled },
    );
    expect(result.find((c) => c.checkId === 'pdf.layout.page-overflow')?.status).toBe('PASS');
  });

  it('flags two different strings drawn at the same position', () => {
    const result = runLayout(
      doc([
        { str: 'AAAAAA', rect: { x: 72, y: 100, w: 60, h: 12 }, fontSize: 12, angle: 0 },
        { str: 'BBBBBB', rect: { x: 72, y: 100.2, w: 60, h: 12 }, fontSize: 12, angle: 0 },
      ]),
      { enabled },
    );
    const overlap = result.find((c) => c.checkId === 'pdf.layout.text-overlap');
    expect(overlap?.status).toBe('FAIL');
    expect(overlap?.issues[0]?.confidence).toBe('confirmed');
  });

  it('does not flag normal adjacent runs on one line', () => {
    const result = runLayout(
      doc([
        { str: 'Hello', rect: { x: 72, y: 100, w: 28, h: 12 }, fontSize: 12, angle: 0 },
        { str: 'world', rect: { x: 104, y: 100, w: 30, h: 12 }, fontSize: 12, angle: 0 },
      ]),
      { enabled },
    );
    expect(result.find((c) => c.checkId === 'pdf.layout.text-overlap')?.status).toBe('PASS');
  });
});
