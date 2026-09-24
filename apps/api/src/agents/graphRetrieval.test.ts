import { describe, expect, it } from 'vitest';
import type { Citation, Entity } from '@kg/shared';
import { GraphStore } from '../services/graphStore.js';
import {
  GRAPH_BOOST,
  expandFromCitations,
  rerankByGraph,
  seedEntityIds,
} from './graphRetrieval.js';

function citation(chunkId: string, score: number): Citation {
  return { chunkId, documentId: 'doc', documentTitle: 'Doc', snippet: chunkId, score };
}

function entity(id: string, sourceChunkIds: string[]): Entity {
  return { id, label: id, type: 'concept', properties: {}, sourceChunkIds, salience: 0 };
}

function buildStore(): GraphStore {
  const store = new GraphStore('/tmp/kg-test-graph-retrieval');
  store.mergeExtraction(
    [
      { label: 'Alpha', type: 'concept' },
      { label: 'Beta', type: 'concept' },
    ],
    [{ sourceLabel: 'Alpha', targetLabel: 'Beta', type: 'R', label: 'r', weight: 0.5 }],
    ['c1'],
  );
  store.mergeExtraction(
    [
      { label: 'Beta', type: 'concept' },
      { label: 'Gamma', type: 'concept' },
    ],
    [{ sourceLabel: 'Beta', targetLabel: 'Gamma', type: 'R', label: 'r', weight: 0.5 }],
    ['c2'],
  );
  store.upsertEntity({ label: 'Isolated', type: 'concept' }, ['c9']);
  return store;
}

describe('seedEntityIds', () => {
  it('returns entities whose provenance includes a retrieved chunk', () => {
    const store = buildStore();
    const seeds = seedEntityIds(store.toKnowledgeGraph(), [citation('c1', 0.9)]);
    const labels = seeds.map((id) => store.getEntity(id)?.label).sort();
    expect(labels).toEqual(['Alpha', 'Beta']);
  });

  it('returns nothing when no retrieved chunk produced an entity', () => {
    const store = buildStore();
    expect(seedEntityIds(store.toKnowledgeGraph(), [citation('c404', 0.9)])).toEqual([]);
  });
});

describe('expandFromCitations', () => {
  it('walks one hop from the seeds and returns the touched sub-graph', () => {
    const store = buildStore();
    const { entities, relations } = expandFromCitations(store, [citation('c1', 0.9)]);
    expect(entities.map((e) => e.label).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(relations.length).toBe(2);
  });
});

describe('rerankByGraph', () => {
  it('boosts graph-connected chunks above higher-scoring unconnected ones', () => {
    const citations = [citation('plain', 0.8), citation('linked', 0.7)];
    const { ranked, boostedCount } = rerankByGraph(citations, [entity('e1', ['linked'])]);
    expect(ranked.map((c) => c.chunkId)).toEqual(['linked', 'plain']);
    expect(boostedCount).toBe(1);
  });

  it('keeps the vector order when the score gap exceeds the boost', () => {
    const citations = [citation('plain', 0.8), citation('linked', 0.8 - GRAPH_BOOST - 0.01)];
    const { ranked } = rerankByGraph(citations, [entity('e1', ['linked'])]);
    expect(ranked.map((c) => c.chunkId)).toEqual(['plain', 'linked']);
  });

  it('leaves the order unchanged when every chunk is boosted', () => {
    const citations = [citation('a', 0.9), citation('b', 0.5)];
    const { ranked, boostedCount } = rerankByGraph(citations, [entity('e1', ['a', 'b'])]);
    expect(ranked.map((c) => c.chunkId)).toEqual(['a', 'b']);
    expect(boostedCount).toBe(2);
  });

  it('does not mutate the input or the citation scores', () => {
    const citations = [citation('plain', 0.8), citation('linked', 0.7)];
    const { ranked } = rerankByGraph(citations, [entity('e1', ['linked'])]);
    expect(citations.map((c) => c.chunkId)).toEqual(['plain', 'linked']);
    expect(ranked.find((c) => c.chunkId === 'linked')?.score).toBe(0.7);
  });
});
