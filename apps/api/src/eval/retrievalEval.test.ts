import { describe, expect, it } from 'vitest';
import type { Corpus, EvalSet } from './dataset.js';
import { runRetrievalEval } from './retrievalEval.js';

const corpus: Corpus = {
  name: 'tiny',
  note: 'test corpus',
  documents: [
    {
      title: 'Lines',
      content: 'The Amber Line is operated with Series 40 trains. It runs to Kestrel Hill.',
    },
    {
      title: 'Fleet',
      content: 'The Series 40 is built by Corvel Works in Brennock.',
    },
    {
      title: 'Fares',
      content: 'Tallypass is a contactless smart card used to pay fares.',
    },
  ],
};

const evalSet: EvalSet = {
  name: 'tiny-set',
  author: 'test author, repo author',
  note: 'test set',
  topK: 2,
  items: [
    {
      id: 's01',
      kind: 'single-hop',
      question: 'What smart card pays fares?',
      evidence: [{ document: 'Fares', contains: 'contactless smart card' }],
    },
    {
      id: 'm01',
      kind: 'multi-hop',
      question: 'Who builds the Amber Line trains?',
      evidence: [
        { document: 'Lines', contains: 'Series 40 trains' },
        { document: 'Fleet', contains: 'built by Corvel Works' },
      ],
    },
  ],
};

describe('runRetrievalEval', () => {
  it('scores every item in both modes', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    expect(report.items.map((i) => i.id)).toEqual(['s01', 'm01']);
    expect(report.summary.vectorOnly.all.items).toBe(2);
    expect(report.summary.graphExpand.all.items).toBe(2);
    expect(report.summary.vectorOnly.byKind['multi-hop']?.items).toBe(1);
  });

  it('records the corpus size built by the real ingestion pipeline', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    expect(report.corpus.documents).toBe(3);
    expect(report.corpus.chunks).toBeGreaterThanOrEqual(3);
    expect(report.corpus.entities).toBeGreaterThan(0);
  });

  it('is deterministic across runs', async () => {
    const first = await runRetrievalEval(corpus, evalSet);
    const second = await runRetrievalEval(corpus, evalSet);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('only reorders: graph mode retrieves the same candidate set as vector mode', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    for (const item of report.items) {
      expect([...item.graphExpand.retrieved].sort()).toEqual([...item.vectorOnly.retrieved].sort());
    }
  });

  it('counts rank changes between the two modes', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    const { improved, worsened, unchanged } = report.comparison;
    expect(improved + worsened + unchanged).toBe(evalSet.items.length);
  });
});
