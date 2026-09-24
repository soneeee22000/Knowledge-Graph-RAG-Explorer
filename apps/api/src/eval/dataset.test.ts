import { describe, expect, it } from 'vitest';
import { EVAL_DIR, loadCorpus, loadEvalSet } from './dataset.js';

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('committed evaluation data', () => {
  it('parses the corpus and the question set', async () => {
    const corpus = await loadCorpus(EVAL_DIR);
    const evalSet = await loadEvalSet(EVAL_DIR);
    expect(corpus.documents.length).toBeGreaterThanOrEqual(5);
    expect(evalSet.items.length).toBeGreaterThanOrEqual(20);
  });

  it('labels the question set as authored by the repo author', async () => {
    const evalSet = await loadEvalSet(EVAL_DIR);
    expect(evalSet.author).toMatch(/repo author/);
  });

  it('has unique item ids', async () => {
    const evalSet = await loadEvalSet(EVAL_DIR);
    const ids = evalSet.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every evidence phrase at text that exists in the named document', async () => {
    const corpus = await loadCorpus(EVAL_DIR);
    const evalSet = await loadEvalSet(EVAL_DIR);
    const byTitle = new Map(corpus.documents.map((d) => [d.title, normalise(d.content)]));
    for (const item of evalSet.items) {
      for (const evidence of item.evidence) {
        const content = byTitle.get(evidence.document);
        expect(content, `${item.id}: unknown document ${evidence.document}`).toBeDefined();
        expect(content, `${item.id}: phrase not found`).toContain(evidence.contains);
      }
    }
  });

  it('gives multi-hop items at least two evidence items', async () => {
    const evalSet = await loadEvalSet(EVAL_DIR);
    for (const item of evalSet.items.filter((i) => i.kind === 'multi-hop')) {
      expect(item.evidence.length, item.id).toBeGreaterThanOrEqual(2);
    }
  });
});
