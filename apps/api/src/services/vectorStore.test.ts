import { describe, expect, it } from 'vitest';
import type { Chunk } from '@kg/shared';
import { cosineSimilarity, VectorStore } from './vectorStore.js';

function chunk(id: string, text = 'x'): Chunk {
  return { id, documentId: 'doc1', index: 0, text };
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('VectorStore.search', () => {
  it('returns the most similar chunk first', () => {
    const store = new VectorStore('/tmp/kg-test-vectors');
    store.add([
      { chunk: chunk('a'), embedding: [1, 0, 0] },
      { chunk: chunk('b'), embedding: [0, 1, 0] },
      { chunk: chunk('c'), embedding: [0.9, 0.1, 0] },
    ]);
    const hits = store.search([1, 0, 0], 3);
    expect(hits[0]!.chunk.id).toBe('a');
    expect(hits[1]!.chunk.id).toBe('c');
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    // Scores are clamped to [0, 1].
    for (const h of hits) {
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThanOrEqual(1);
    }
  });

  it('respects topK', () => {
    const store = new VectorStore('/tmp/kg-test-vectors');
    store.add([
      { chunk: chunk('a'), embedding: [1, 0] },
      { chunk: chunk('b'), embedding: [0, 1] },
    ]);
    expect(store.search([1, 0], 1)).toHaveLength(1);
  });
});
