import type { Citation, Entity, KnowledgeGraph, Relation } from '@kg/shared';
import type { GraphStore } from '../services/graphStore.js';

/** Score added to a retrieved chunk that contributed an entity reached by graph expansion. */
export const GRAPH_BOOST = 0.15;

/** Hop distance walked from the seed entities during graph expansion. */
export const EXPANSION_DEPTH = 1;

/** Entities and relations touched by graph expansion. */
export interface ExpandedSubgraph {
  entities: Entity[];
  relations: Relation[];
}

/** Result of the graph-aware rerank. */
export interface GraphRerank {
  ranked: Citation[];
  boostedCount: number;
}

/**
 * Seed entities for expansion: every entity whose provenance includes one of
 * the retrieved chunks.
 */
export function seedEntityIds(graph: KnowledgeGraph, citations: Citation[]): string[] {
  const retrievedChunkIds = new Set(citations.map((c) => c.chunkId));
  return graph.entities
    .filter((e) => e.sourceChunkIds.some((id) => retrievedChunkIds.has(id)))
    .map((e) => e.id);
}

/**
 * Expand from the seed entities of the retrieved chunks along graph edges,
 * deduplicating entities and relations reached from several seeds.
 */
export function expandFromCitations(
  graphStore: GraphStore,
  citations: Citation[],
  depth: number = EXPANSION_DEPTH,
): ExpandedSubgraph {
  const entityMap = new Map<string, Entity>();
  const relationMap = new Map<string, Relation>();
  for (const id of seedEntityIds(graphStore.toKnowledgeGraph(), citations)) {
    const sub = graphStore.neighbors(id, depth);
    for (const e of sub.entities) entityMap.set(e.id, e);
    for (const r of sub.relations) relationMap.set(r.id, r);
  }
  return { entities: [...entityMap.values()], relations: [...relationMap.values()] };
}

/**
 * Reorder the retrieved citations so chunks that contributed an expanded
 * entity gain `boost` before sorting. The candidate set is unchanged: this
 * can only reorder what vector retrieval already returned.
 */
export function rerankByGraph(
  citations: Citation[],
  expandedEntities: Entity[],
  boost: number = GRAPH_BOOST,
): GraphRerank {
  const boostedChunkIds = new Set(expandedEntities.flatMap((e) => e.sourceChunkIds));
  const boosted = (c: Citation): number => c.score + (boostedChunkIds.has(c.chunkId) ? boost : 0);
  const ranked = [...citations].sort((a, b) => boosted(b) - boosted(a));
  const boostedCount = citations.filter((c) => boostedChunkIds.has(c.chunkId)).length;
  return { ranked, boostedCount };
}
