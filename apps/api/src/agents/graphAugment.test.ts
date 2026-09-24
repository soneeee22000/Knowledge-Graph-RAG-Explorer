import { describe, expect, it } from 'vitest';
import type { Entity, KnowledgeGraph, Relation } from '@kg/shared';
import {
  GRAPH_SUPPORT_WEIGHT,
  HOP_DECAY,
  SEED_CHUNK_COUNT,
  augmentWithGraph,
  type VectorCandidate,
} from './graphRetrieval.js';

function entity(id: string, sourceChunkIds: string[]): Entity {
  return { id, label: id, type: 'concept', properties: {}, sourceChunkIds, salience: 0 };
}

function relation(sourceId: string, targetId: string): Relation {
  return {
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    type: 'RELATED_TO',
    label: 'related to',
    weight: 0.5,
    sourceChunkIds: [],
  };
}

function ranking(...pairs: Array<[string, number]>): VectorCandidate[] {
  return pairs.map(([chunkId, score]) => ({ chunkId, score }));
}

const EMPTY_GRAPH: KnowledgeGraph = { entities: [], relations: [] };

describe('augmentWithGraph', () => {
  it('returns the vector top-k unchanged when the graph links nothing', () => {
    const result = augmentWithGraph(ranking(['a', 0.9], ['b', 0.5], ['c', 0.4]), EMPTY_GRAPH, 2);
    expect(result.ranked.map((c) => c.chunkId)).toEqual(['a', 'b']);
    expect(result.addedChunkIds).toEqual([]);
    expect(result.promotedChunkIds).toEqual([]);
  });

  it('adds a chunk outside the vector top-k that shares an entity with a seed chunk', () => {
    const graph: KnowledgeGraph = { entities: [entity('bridge', ['a', 'far'])], relations: [] };
    const result = augmentWithGraph(
      ranking(['a', 0.9], ['b', 0.3], ['c', 0.2], ['far', 0.1]),
      graph,
      2,
    );
    expect(result.addedChunkIds).toEqual(['far']);
    expect(result.promotedChunkIds).toEqual(['far']);
    expect(result.ranked.map((c) => c.chunkId)).toEqual(['a', 'far']);
    const far = result.ranked.find((c) => c.chunkId === 'far');
    expect(far?.source).toBe('graph');
    expect(far?.link).toEqual({ entityId: 'bridge', hop: 0, seedChunkId: 'a' });
  });

  it('scores a shared entity as seed score x specificity (1 / chunks mentioning it)', () => {
    const graph: KnowledgeGraph = { entities: [entity('bridge', ['a', 'far'])], relations: [] };
    const result = augmentWithGraph(ranking(['a', 0.9], ['b', 0.3], ['far', 0.1]), graph, 1);
    const far = result.candidates.find((c) => c.chunkId === 'far');
    const expectedSupport = 0.9 * (1 / 2);
    expect(far?.graphSupport).toBeCloseTo(expectedSupport, 10);
    expect(far?.combinedScore).toBeCloseTo(0.1 + GRAPH_SUPPORT_WEIGHT * expectedSupport, 10);
  });

  it('reaches chunks one hop away through a relation, discounted by HOP_DECAY', () => {
    const graph: KnowledgeGraph = {
      entities: [entity('seed', ['a']), entity('neighbour', ['far'])],
      relations: [relation('neighbour', 'seed')],
    };
    const result = augmentWithGraph(ranking(['a', 0.8], ['b', 0.3], ['far', 0.1]), graph, 2);
    const far = result.candidates.find((c) => c.chunkId === 'far');
    expect(far?.graphSupport).toBeCloseTo(0.8 * HOP_DECAY, 10);
    expect(far?.link).toEqual({ entityId: 'neighbour', hop: 1, seedChunkId: 'a' });
  });

  it('gives an entity mentioned in many chunks less support than a specific one', () => {
    const graph: KnowledgeGraph = {
      entities: [entity('hub', ['a', 'x', 'y', 'z', 'hubbed']), entity('rare', ['a', 'rared'])],
      relations: [],
    };
    const result = augmentWithGraph(
      ranking(['a', 0.9], ['x', 0.1], ['y', 0.1], ['z', 0.1], ['hubbed', 0.05], ['rared', 0.05]),
      graph,
      1,
    );
    const support = (id: string): number =>
      result.candidates.find((c) => c.chunkId === id)?.graphSupport ?? 0;
    expect(support('rared')).toBeGreaterThan(support('hubbed'));
  });

  it('never lets a seed chunk support itself', () => {
    const graph: KnowledgeGraph = { entities: [entity('only-here', ['a'])], relations: [] };
    const result = augmentWithGraph(ranking(['a', 0.9], ['b', 0.5]), graph, 2);
    expect(result.candidates.find((c) => c.chunkId === 'a')?.graphSupport).toBe(0);
  });

  it('seeds only from the top SEED_CHUNK_COUNT vector chunks', () => {
    const top = Array.from({ length: SEED_CHUNK_COUNT }, (_, i): [string, number] => [
      `top${i}`,
      0.9 - i * 0.01,
    ]);
    const graph: KnowledgeGraph = {
      entities: [entity('late-bridge', ['late', 'far'])],
      relations: [],
    };
    const result = augmentWithGraph(
      ranking(...top, ['late', 0.5], ['far', 0.1]),
      graph,
      SEED_CHUNK_COUNT + 1,
    );
    expect(result.addedChunkIds).toEqual([]);
  });

  it('cuts the reranked union to k', () => {
    const graph: KnowledgeGraph = {
      entities: [entity('e', ['a', 'f1', 'f2', 'f3'])],
      relations: [],
    };
    const result = augmentWithGraph(
      ranking(['a', 0.9], ['b', 0.2], ['f1', 0.1], ['f2', 0.1], ['f3', 0.1]),
      graph,
      2,
    );
    expect(result.ranked).toHaveLength(2);
    expect(result.addedChunkIds.sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('breaks combined-score ties by vector rank, deterministically', () => {
    const graph: KnowledgeGraph = { entities: [entity('e', ['a', 'p', 'q'])], relations: [] };
    const input = ranking(['a', 0.9], ['b', 0.05], ['p', 0.1], ['q', 0.1]);
    const first = augmentWithGraph(input, graph, 3);
    const second = augmentWithGraph(input, graph, 3);
    expect(first.ranked.map((c) => c.chunkId)).toEqual(['a', 'p', 'q']);
    expect(first.ranked[1]?.combinedScore).toBe(first.ranked[2]?.combinedScore);
    expect(second).toEqual(first);
  });

  it('keeps vector order among top-k chunks whose combined scores tie', () => {
    const result = augmentWithGraph(ranking(['a', 0.5], ['b', 0.5], ['c', 0.5]), EMPTY_GRAPH, 3);
    expect(result.ranked.map((c) => c.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its inputs', () => {
    const graph: KnowledgeGraph = { entities: [entity('e', ['a', 'far'])], relations: [] };
    const input = ranking(['a', 0.9], ['b', 0.3], ['far', 0.1]);
    const snapshot = JSON.stringify({ input, graph });
    augmentWithGraph(input, graph, 2);
    expect(JSON.stringify({ input, graph })).toBe(snapshot);
  });

  it('returns the traversed sub-graph: seed entities, their neighbours and the edges between them', () => {
    const graph: KnowledgeGraph = {
      entities: [entity('seed', ['a']), entity('neighbour', ['far']), entity('unrelated', ['z'])],
      relations: [relation('seed', 'neighbour')],
    };
    const result = augmentWithGraph(ranking(['a', 0.8], ['far', 0.1], ['z', 0.1]), graph, 2);
    expect(result.subgraph.entities.map((e) => e.id).sort()).toEqual(['neighbour', 'seed']);
    expect(result.subgraph.relations.map((r) => r.id)).toEqual(['seed->neighbour']);
  });
});
