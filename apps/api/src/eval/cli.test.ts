import { describe, expect, it } from 'vitest';
import { formatSummaryTable, parseCliArgs, sameReport, serializeReport } from './cliSupport.js';
import type { EvalReport } from './retrievalEval.js';

const summary = {
  items: 2,
  hitAt1: 1,
  hitAt3: 2,
  mrr: 0.75,
  allEvidenceRetrieved: 1,
  evidenceFound: 3,
  evidenceTotal: 4,
};

const report: EvalReport = {
  evalSet: { name: 'set', author: 'repo author', items: 2 },
  corpus: { name: 'c', documents: 1, chunks: 2, entities: 3, relations: 4 },
  config: { provider: 'mock', topK: 6, graphBoost: 0.15, expansionDepth: 1 },
  summary: {
    vectorOnly: { all: summary, byKind: { 'single-hop': summary } },
    graphExpand: { all: summary, byKind: { 'single-hop': summary } },
  },
  comparison: { improved: 0, worsened: 0, unchanged: 2, orderChanged: 0 },
  items: [],
};

describe('parseCliArgs', () => {
  it('reads --json and --check paths', () => {
    expect(parseCliArgs(['--json', 'out.json'])).toEqual({ json: 'out.json', check: undefined });
    expect(parseCliArgs(['--check', 'eval/results.json']).check).toBe('eval/results.json');
  });

  it('rejects a flag without a value', () => {
    expect(() => parseCliArgs(['--json'])).toThrow(/--json/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseCliArgs(['--nope'])).toThrow(/--nope/);
  });
});

describe('formatSummaryTable', () => {
  it('renders one row per mode and kind', () => {
    const table = formatSummaryTable(report);
    expect(table).toContain('| vector-only | all | 2 | 1/2 | 2/2 | 0.750 | 1/2 |');
    expect(table).toContain('| graph-expand | single-hop |');
  });
});

describe('serializeReport and sameReport', () => {
  it('ends with a newline and ignores line-ending differences', () => {
    const text = serializeReport(report);
    expect(text.endsWith('\n')).toBe(true);
    expect(sameReport(text, text.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('detects a changed number', () => {
    const changed = serializeReport({
      ...report,
      comparison: { ...report.comparison, improved: 1 },
    });
    expect(sameReport(serializeReport(report), changed)).toBe(false);
  });
});
