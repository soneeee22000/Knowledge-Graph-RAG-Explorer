import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { Edge, Node } from '@vue-flow/core';
import type { Entity, KnowledgeGraph, Relation } from '@kg/shared';
import { getGraph } from '@/lib/apiClient';

export interface EntityNodeData {
  entity: Entity;
  highlighted: boolean;
}

export type GraphNode = Node<EntityNodeData>;
export type GraphEdge = Edge<{ relation: Relation; highlighted: boolean }>;

/**
 * Deterministic radial layout. Nodes are sorted by salience (most-connected
 * first) and placed on concentric rings, so the graph reads center-out without
 * pulling in a physics engine. Stable across renders for a calm canvas.
 */
function radialLayout(entities: Entity[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const sorted = [...entities].sort((a, b) => b.salience - a.salience);
  const n = sorted.length;
  if (n === 0) return positions;

  const center = { x: 0, y: 0 };
  if (n === 1) {
    positions.set(sorted[0]!.id, center);
    return positions;
  }

  // Ring capacities grow outward: 1 (hub), 6, 12, 18, ...
  const rings: Entity[][] = [];
  let placed = 0;
  let ringIndex = 0;
  // First, optionally seat the single most-salient node at the hub.
  rings.push([sorted[0]!]);
  placed = 1;
  ringIndex = 1;
  while (placed < n) {
    const capacity = ringIndex * 6;
    const ring = sorted.slice(placed, placed + capacity);
    rings.push(ring);
    placed += ring.length;
    ringIndex += 1;
  }

  const radiusStep = 260;
  rings.forEach((ring, ri) => {
    if (ri === 0) {
      positions.set(ring[0]!.id, center);
      return;
    }
    const radius = ri * radiusStep;
    const count = ring.length;
    // Offset alternate rings for a less grid-like, organic feel.
    const angleOffset = (ri % 2) * (Math.PI / count);
    ring.forEach((entity, i) => {
      const angle = angleOffset + (i / count) * Math.PI * 2;
      positions.set(entity.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  });

  return positions;
}

/** Node diameter scales with salience for an at-a-glance importance read. */
function nodeSize(salience: number): number {
  const clamped = Math.min(1, Math.max(0, salience));
  return Math.round(72 + clamped * 96); // 72px .. 168px
}

export const useGraphStore = defineStore('graph', () => {
  const graph = shallowRef<KnowledgeGraph>({ entities: [], relations: [] });
  const highlightedIds = ref<Set<string>>(new Set());
  const selectedId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Bumped whenever data changes so the canvas can re-fit the view. */
  const revision = ref(0);

  const positions = computed(() => radialLayout(graph.value.entities));

  const nodes = computed<GraphNode[]>(() =>
    graph.value.entities.map((entity) => {
      const pos = positions.value.get(entity.id) ?? { x: 0, y: 0 };
      const size = nodeSize(entity.salience);
      return {
        id: entity.id,
        type: 'entity',
        position: pos,
        data: {
          entity,
          highlighted: highlightedIds.value.has(entity.id),
        },
        // Center the node on its computed position.
        style: { width: `${size}px`, height: `${size}px` },
        draggable: true,
      } satisfies GraphNode;
    }),
  );

  const edges = computed<GraphEdge[]>(() => {
    const present = new Set(graph.value.entities.map((e) => e.id));
    return graph.value.relations
      .filter((r) => present.has(r.sourceId) && present.has(r.targetId))
      .map((relation) => {
        const hot =
          highlightedIds.value.has(relation.sourceId) &&
          highlightedIds.value.has(relation.targetId);
        return {
          id: relation.id,
          source: relation.sourceId,
          target: relation.targetId,
          label: relation.label,
          type: 'default',
          animated: hot,
          data: { relation, highlighted: hot },
          markerEnd: 'arrow',
          style: {
            strokeWidth: hot ? 2.5 : 1 + relation.weight * 1.5,
            stroke: hot ? '#6366f1' : '#3a4255',
            opacity: highlightedIds.value.size === 0 || hot ? 1 : 0.25,
          },
        } satisfies GraphEdge;
      });
  });

  const entityCount = computed(() => graph.value.entities.length);
  const relationCount = computed(() => graph.value.relations.length);
  const isEmpty = computed(() => entityCount.value === 0);

  function setGraph(next: KnowledgeGraph): void {
    graph.value = next;
    revision.value += 1;
  }

  /**
   * Merge newly-discovered entities/relations (e.g. from a query's `graph`
   * event) into the canvas without dropping what's already there.
   */
  function mergeGraph(
    newEntities: Entity[],
    newRelations: Relation[],
  ): void {
    const entityMap = new Map(graph.value.entities.map((e) => [e.id, e]));
    for (const e of newEntities) entityMap.set(e.id, e);
    const relationMap = new Map(graph.value.relations.map((r) => [r.id, r]));
    for (const r of newRelations) relationMap.set(r.id, r);
    setGraph({
      entities: [...entityMap.values()],
      relations: [...relationMap.values()],
    });
  }

  function highlight(ids: string[]): void {
    highlightedIds.value = new Set(ids);
  }

  function highlightOne(id: string): void {
    highlightedIds.value = new Set([id]);
    selectedId.value = id;
  }

  function clearHighlight(): void {
    highlightedIds.value = new Set();
  }

  function select(id: string | null): void {
    selectedId.value = id;
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      setGraph(await getGraph());
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load graph';
    } finally {
      loading.value = false;
    }
  }

  function clear(): void {
    setGraph({ entities: [], relations: [] });
    clearHighlight();
    selectedId.value = null;
  }

  return {
    graph,
    highlightedIds,
    selectedId,
    loading,
    error,
    revision,
    nodes,
    edges,
    entityCount,
    relationCount,
    isEmpty,
    setGraph,
    mergeGraph,
    highlight,
    highlightOne,
    clearHighlight,
    select,
    refresh,
    clear,
  };
});
