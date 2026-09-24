import { describe, expect, it } from 'vitest';
import { questionsFileFor } from './cliSupport.js';
import {
  EVAL_DIR,
  POSTFIX_QUESTIONS_FILE,
  QUESTIONS_FILE,
  loadCorpus,
  loadEvalSet,
} from './dataset.js';

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('questionsFileFor', () => {
  it('maps each committed results file to its question set', () => {
    expect(questionsFileFor('eval/results.json')).toBe(QUESTIONS_FILE);
    expect(questionsFileFor('eval/results-postfix.json')).toBe(POSTFIX_QUESTIONS_FILE);
  });

  it('rejects a results file with no known question set', () => {
    expect(() => questionsFileFor('eval/other.json')).toThrow(/other\.json/);
  });
});

describe('post-fix question set', () => {
  it('is labelled as written after the graph fix, by the repo author', async () => {
    const evalSet = await loadEvalSet(EVAL_DIR, POSTFIX_QUESTIONS_FILE);
    expect(evalSet.author).toMatch(/repo author/);
    expect(evalSet.note).toMatch(/after/i);
    expect(evalSet.items.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the app default topK and ids distinct from the original set', async () => {
    const original = await loadEvalSet(EVAL_DIR);
    const postfix = await loadEvalSet(EVAL_DIR, POSTFIX_QUESTIONS_FILE);
    expect(postfix.topK).toBe(original.topK);
    const originalIds = new Set(original.items.map((item) => item.id));
    const ids = postfix.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(originalIds.has(id), id).toBe(false);
  });

  it('only has multi-hop items with two evidence documents', async () => {
    const postfix = await loadEvalSet(EVAL_DIR, POSTFIX_QUESTIONS_FILE);
    for (const item of postfix.items) {
      expect(item.kind, item.id).toBe('multi-hop');
      expect(new Set(item.evidence.map((e) => e.document)).size, item.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('points every evidence phrase at text in the named document', async () => {
    const corpus = await loadCorpus(EVAL_DIR);
    const postfix = await loadEvalSet(EVAL_DIR, POSTFIX_QUESTIONS_FILE);
    const byTitle = new Map(corpus.documents.map((d) => [d.title, normalise(d.content)]));
    for (const item of postfix.items) {
      for (const evidence of item.evidence) {
        expect(byTitle.get(evidence.document), `${item.id}: ${evidence.document}`).toContain(
          evidence.contains,
        );
      }
    }
  });
});
