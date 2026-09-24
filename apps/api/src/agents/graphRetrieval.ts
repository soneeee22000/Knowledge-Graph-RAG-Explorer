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

/* ------------------------------------------------------------------ */
/* Graph-augmented retrieval: expansion adds candidates                */
/* ------------------------------------------------------------------ */

/** How many of the top vector chunks seed the graph expansion. */
export const SEED_CHUNK_COUNT = 3;

/** Support multiplier per hop: an entity one relation away from a seed entity counts half. */
export const HOP_DECAY = 0.5;

/** Weight of graph support against vector similarity in the combined score. */
export const GRAPH_SUPPORT_WEIGHT = 1;

/** One chunk of the full vector ranking, in rank order. */
export interface VectorCandidate {
  chunkId: string;
  score: number;
}

/** The strongest graph path that reached a candidate chunk. */
export interface GraphLink {
  entityId: string;
  /** 0: the entity is mentioned in the seed chunk; 1: it is a direct neighbour of one that is. */
  hop: number;
  seedChunkId: string;
}

/** A candidate in the union of the vector top-k and the graph-reached chunks. */
export interface AugmentedCandidate {
  chunkId: string;
  vectorScore: number;
  /** 1-based rank in the full vector ranking. */
  vectorRank: number;
  graphSupport: number;
  combinedScore: number;
  source: 'vector' | 'graph';
  link: GraphLink | null;
}

/** Output of `augmentWithGraph`. */
export interface GraphAugmentation {
  /** The reranked union cut to k. */
  ranked: AugmentedCandidate[];
  /** The whole reranked union, before the cut. */
  candidates: AugmentedCandidate[];
  /** Chunks outside the vector top-k that the graph added to the union. */
  addedChunkIds: string[];
  /** Added chunks that survived the cut to k. */
  promotedChunkIds: string[];
  /** Entities and relations walked from the seed chunks. */
  subgraph: ExpandedSubgraph;
}

interface GraphIndex {
  entityById: Map<string, Entity>;
  entitiesByChunk: Map<string, string[]>;
  neighbours: Map<string, string[]>;
}

interface Reach {
  entityId: string;
  hop: number;
  seed: VectorCandidate;
}

interface Support {
  value: number;
  link: GraphLink;
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function indexGraph(graph: KnowledgeGraph): GraphIndex {
  const entitiesByChunk = new Map<string, string[]>();
  const neighbours = new Map<string, string[]>();
  for (const e of graph.entities) {
    for (const chunkId of e.sourceChunkIds) pushTo(entitiesByChunk, chunkId, e.id);
  }
  for (const r of graph.relations) {
    pushTo(neighbours, r.sourceId, r.targetId);
    pushTo(neighbours, r.targetId, r.sourceId);
  }
  return { entityById: new Map(graph.entities.map((e) => [e.id, e])), entitiesByChunk, neighbours };
}

/** Entities mentioned in each seed chunk (hop 0) and their direct neighbours (hop 1). */
function reachFromSeeds(index: GraphIndex, seeds: VectorCandidate[]): Reach[] {
  const reaches: Reach[] = [];
  for (const seed of seeds) {
    for (const entityId of index.entitiesByChunk.get(seed.chunkId) ?? []) {
      reaches.push({ entityId, hop: 0, seed });
      for (const neighbourId of index.neighbours.get(entityId) ?? []) {
        reaches.push({ entityId: neighbourId, hop: 1, seed });
      }
    }
  }
  return reaches;
}

/**
 * Graph support per chunk. One reach contributes
 * seed vector score x HOP_DECAY^hop x 1 / (chunks mentioning the entity)
 * to every chunk mentioning the entity except the seed chunk itself; a chunk
 * keeps its single strongest contribution (max, not sum, so hub entities
 * cannot pile up).
 */
function computeSupport(index: GraphIndex, reaches: Reach[]): Map<string, Support> {
  const support = new Map<string, Support>();
  for (const { entityId, hop, seed } of reaches) {
    const chunkIds = index.entityById.get(entityId)?.sourceChunkIds ?? [];
    if (chunkIds.length === 0) continue;
    const value = (seed.score * HOP_DECAY ** hop) / chunkIds.length;
    for (const chunkId of chunkIds) {
      if (chunkId === seed.chunkId) continue;
      const current = support.get(chunkId);
      if (current && current.value >= value) continue;
      support.set(chunkId, { value, link: { entityId, hop, seedChunkId: seed.chunkId } });
    }
  }
  return support;
}

function traversedSubgraph(graph: KnowledgeGraph, reaches: Reach[]): ExpandedSubgraph {
  const reached = new Set(reaches.map((r) => r.entityId));
  const entities = graph.entities.filter((e) => reached.has(e.id));
  const relations = graph.relations.filter(
    (r) => reached.has(r.sourceId) && reached.has(r.targetId),
  );
  return { entities, relations };
}

function byCombinedThenVectorRank(a: AugmentedCandidate, b: AugmentedCandidate): number {
  return b.combinedScore - a.combinedScore || a.vectorRank - b.vectorRank;
}

function buildCandidates(
  ranking: VectorCandidate[],
  topK: number,
  support: Map<string, Support>,
): AugmentedCandidate[] {
  const candidates: AugmentedCandidate[] = [];
  ranking.forEach((hit, position) => {
    const inTopK = position < topK;
    const graph = support.get(hit.chunkId);
    if (!inTopK && !graph) return;
    const graphSupport = graph?.value ?? 0;
    candidates.push({
      chunkId: hit.chunkId,
      vectorScore: hit.score,
      vectorRank: position + 1,
      graphSupport,
      combinedScore: hit.score + GRAPH_SUPPORT_WEIGHT * graphSupport,
      source: inTopK ? 'vector' : 'graph',
      link: graph?.link ?? null,
    });
  });
  return candidates.sort(byCombinedThenVectorRank);
}

/**
 * Graph-augmented retrieval. Seeds are the entities of the top
 * `SEED_CHUNK_COUNT` vector chunks; expansion walks one hop and adds every
 * chunk that mentions a reached entity to the vector top-k. The union is
 * reranked by `vectorScore + GRAPH_SUPPORT_WEIGHT x graphSupport` (ties: better
 * vector rank first) and cut to `topK`, so a graph-reached chunk can displace
 * a vector hit.
 *
 * `ranking` must be the full vector ranking of the corpus, best first.
 */
export function augmentWithGraph(
  ranking: VectorCandidate[],
  graph: KnowledgeGraph,
  topK: number,
): GraphAugmentation {
  const index = indexGraph(graph);
  const reaches = reachFromSeeds(index, ranking.slice(0, Math.min(topK, SEED_CHUNK_COUNT)));
  const candidates = buildCandidates(ranking, topK, computeSupport(index, reaches));
  const ranked = candidates.slice(0, topK);
  const graphOnly = (list: AugmentedCandidate[]): string[] =>
    list.filter((c) => c.source === 'graph').map((c) => c.chunkId);
  return {
    ranked,
    candidates,
    addedChunkIds: graphOnly(candidates),
    promotedChunkIds: graphOnly(ranked),
    subgraph: traversedSubgraph(graph, reaches),
  };
}
