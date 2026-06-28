import { describe, expect, it } from 'vitest';
import { GraphStore } from './graphStore.js';

describe('GraphStore', () => {
  it('dedupes entities by normalized label + type and merges provenance', () => {
    const store = new GraphStore('/tmp/kg-test-graph');
    const id1 = store.upsertEntity({ label: 'Mastra AI', type: 'organization' }, ['chunk1']);
    const id2 = store.upsertEntity({ label: 'mastra ai', type: 'organization' }, ['chunk2']);
    expect(id1).toBe(id2);
    expect(store.entityCount).toBe(1);
    const entity = store.getEntity(id1)!;
    expect(entity.sourceChunkIds.sort()).toEqual(['chunk1', 'chunk2']);
  });

  it('treats different types as distinct entities', () => {
    const store = new GraphStore('/tmp/kg-test-graph');
    store.upsertEntity({ label: 'Apple', type: 'organization' });
    store.upsertEntity({ label: 'Apple', type: 'product' });
    expect(store.entityCount).toBe(2);
  });

  it('computes salience in [0,1] with the hub scoring highest', () => {
    const store = new GraphStore('/tmp/kg-test-graph');
    // Star graph: hub connected to three leaves.
    store.mergeExtraction(
      [
        { label: 'Hub', type: 'concept' },
        { label: 'Leaf A', type: 'concept' },
        { label: 'Leaf B', type: 'concept' },
        { label: 'Leaf C', type: 'concept' },
      ],
      [
        { sourceLabel: 'Hub', targetLabel: 'Leaf A', type: 'R', label: 'r', weight: 0.5 },
        { sourceLabel: 'Hub', targetLabel: 'Leaf B', type: 'R', label: 'r', weight: 0.5 },
        { sourceLabel: 'Hub', targetLabel: 'Leaf C', type: 'R', label: 'r', weight: 0.5 },
      ],
      ['c1'],
    );
    const graph = store.toKnowledgeGraph();
    const hub = graph.entities.find((e) => e.label === 'Hub')!;
    const leaf = graph.entities.find((e) => e.label === 'Leaf A')!;
    for (const e of graph.entities) {
      expect(e.salience).toBeGreaterThanOrEqual(0);
      expect(e.salience).toBeLessThanOrEqual(1);
    }
    expect(hub.salience).toBeGreaterThan(leaf.salience);
  });

  it('expands neighbors at depth 1', () => {
    const store = new GraphStore('/tmp/kg-test-graph');
    store.mergeExtraction(
      [
        { label: 'A', type: 'concept' },
        { label: 'B', type: 'concept' },
        { label: 'C', type: 'concept' },
      ],
      [
        { sourceLabel: 'A', targetLabel: 'B', type: 'R', label: 'r', weight: 0.5 },
        { sourceLabel: 'B', targetLabel: 'C', type: 'R', label: 'r', weight: 0.5 },
      ],
      ['c1'],
    );
    const aId = store.findIdByLabel('A')!;
    const sub = store.neighbors(aId, 1);
    const labels = sub.entities.map((e) => e.label).sort();
    expect(labels).toEqual(['A', 'B']);
  });
});
