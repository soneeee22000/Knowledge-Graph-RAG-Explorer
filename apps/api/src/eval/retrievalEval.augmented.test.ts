import { describe, expect, it } from 'vitest';
import { GRAPH_SUPPORT_WEIGHT, HOP_DECAY, SEED_CHUNK_COUNT } from '../agents/graphRetrieval.js';
import { formatSummaryTable } from './cliSupport.js';
import type { Corpus, EvalSet } from './dataset.js';
import { runRetrievalEval } from './retrievalEval.js';

const corpus: Corpus = {
  name: 'tiny-bridge',
  note: 'test corpus where the answer chunk shares no words with the question',
  documents: [
    {
      title: 'Amber Line',
      content: 'The Amber Line runs every ten minutes. The Amber Line uses Zephyr trains.',
    },
    { title: 'Fleet', content: 'Zephyr units are assembled by Corvel Works in Brennock.' },
    { title: 'Timetable', content: 'Evening services run every twenty minutes.' },
    { title: 'Fares', content: 'Trains on the network accept Tallypass cards.' },
  ],
};

const evalSet: EvalSet = {
  name: 'tiny-bridge-set',
  author: 'test author, repo author',
  note: 'test set',
  topK: 2,
  items: [
    {
      id: 'm01',
      kind: 'multi-hop',
      question: 'Which trains run on the Amber Line?',
      evidence: [
        { document: 'Amber Line', contains: 'uses Zephyr trains' },
        { document: 'Fleet', contains: 'assembled by Corvel Works' },
      ],
    },
    {
      id: 's01',
      kind: 'single-hop',
      question: 'Which cards do trains accept?',
      evidence: [{ document: 'Fares', contains: 'accept Tallypass cards' }],
    },
  ],
};

describe('runRetrievalEval graph-augmented mode', () => {
  it('scores every item in the graph-augmented mode and records its constants', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    expect(report.summary.graphAugmented.all.items).toBe(2);
    expect(report.config.seedChunkCount).toBe(SEED_CHUNK_COUNT);
    expect(report.config.hopDecay).toBe(HOP_DECAY);
    expect(report.config.graphSupportWeight).toBe(GRAPH_SUPPORT_WEIGHT);
  });

  it('can retrieve evidence that the vector top-k missed', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    const bridge = report.items.find((i) => i.id === 'm01');
    expect(bridge?.vectorOnly.evidenceFound).toBe(1);
    expect(bridge?.graphAugmented.evidenceFound).toBe(2);
    expect(bridge?.graphAugmented.promotedChunks).toEqual(['Fleet#0']);
  });

  it('never returns more than topK chunks, and promoted chunks were outside the vector top-k', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    for (const item of report.items) {
      const augmented = item.graphAugmented;
      expect(augmented.retrieved.length).toBeLessThanOrEqual(evalSet.topK);
      for (const chunk of augmented.promotedChunks) {
        expect(augmented.retrieved).toContain(chunk);
        expect(augmented.addedChunks).toContain(chunk);
        expect(item.vectorOnly.retrieved).not.toContain(chunk);
      }
    }
  });

  it('compares graph-augmented with vector-only over every item', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    const { improved, worsened, unchanged } = report.comparisonAugmented;
    expect(improved + worsened + unchanged).toBe(evalSet.items.length);
  });

  it('prints graph-augmented rows in the summary table', async () => {
    const report = await runRetrievalEval(corpus, evalSet);
    expect(formatSummaryTable(report)).toContain('| graph-augmented | all | 2 |');
  });
});
