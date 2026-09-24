import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  CitationSchema,
  EntitySchema,
  RelationSchema,
  type Chunk,
  type Citation,
  type Entity,
  type Relation,
} from '@kg/shared';
import type { AppStores } from '../services/stores.js';
import type { VectorHit } from '../services/vectorStore.js';
import { augmentWithGraph, type GraphAugmentation } from './graphRetrieval.js';

/**
 * Shared retrieval logic — the single real implementation behind BOTH the
 * Mastra tools and the orchestration pipeline. Invoking a tool and running the
 * deterministic pipeline therefore execute identical code, so the tools are
 * never decorative.
 */

/** Longest snippet carried by a citation. */
const SNIPPET_LENGTH = 280;

function toCitation(stores: AppStores, chunk: Chunk, score: number): Citation {
  const document = stores.corpus.listDocuments().find((d) => d.id === chunk.documentId);
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: document?.title ?? chunk.documentId,
    snippet: chunk.text.slice(0, SNIPPET_LENGTH),
    score,
  };
}

/** Every chunk in the corpus ranked by cosine similarity to the query, best first. */
export async function rankAllChunks(stores: AppStores, query: string): Promise<VectorHit[]> {
  const [embedding] = await stores.provider.embed([query]);
  return stores.vectorStore.search(embedding ?? [], stores.vectorStore.size);
}

/** Dense vector retrieval → citations, via the configured provider's embedder. */
export async function retrieveContext(
  stores: AppStores,
  query: string,
  topK: number,
): Promise<Citation[]> {
  const hits = (await rankAllChunks(stores, query)).slice(0, topK);
  return hits.map((hit) => toCitation(stores, hit.chunk, hit.score));
}

/** Vector top-k plus the graph-augmented top-k built from the same ranking. */
export interface GraphRetrievalResult {
  vectorCitations: Citation[];
  citations: Citation[];
  augmentation: GraphAugmentation;
}

/**
 * Retrieve with graph expansion: rank the corpus once, then let
 * `augmentWithGraph` add graph-reached chunks and rerank the union. Citation
 * scores stay the cosine similarity; the order is the combined score.
 */
export async function retrieveWithGraph(
  stores: AppStores,
  query: string,
  topK: number,
): Promise<GraphRetrievalResult> {
  const ranking = await rankAllChunks(stores, query);
  const chunks = new Map(ranking.map((hit) => [hit.chunk.id, hit.chunk]));
  const augmentation = augmentWithGraph(
    ranking.map((hit) => ({ chunkId: hit.chunk.id, score: hit.score })),
    stores.graphStore.toKnowledgeGraph(),
    topK,
  );
  const cite = (chunkId: string, score: number): Citation =>
    toCitation(stores, chunks.get(chunkId)!, score);
  return {
    vectorCitations: ranking.slice(0, topK).map((hit) => toCitation(stores, hit.chunk, hit.score)),
    citations: augmentation.ranked.map((c) => cite(c.chunkId, c.vectorScore)),
    augmentation,
  };
}

/** Expand seed entities along graph edges to a hop depth. */
export function expandGraph(
  stores: AppStores,
  entityIds: string[],
  depth: number,
): { entities: Entity[]; relations: Relation[] } {
  const entityMap = new Map<string, Entity>();
  const relationMap = new Map<string, Relation>();
  for (const id of entityIds) {
    const sub = stores.graphStore.neighbors(id, depth);
    for (const e of sub.entities) entityMap.set(e.id, e);
    for (const r of sub.relations) relationMap.set(r.id, r);
  }
  return { entities: [...entityMap.values()], relations: [...relationMap.values()] };
}

/**
 * Mastra tool definitions for the RAG agent. Genuine `createTool` definitions
 * with zod input/output schemas; their `execute` runs the shared functions
 * above, so when the keyed Mastra agent autonomously calls a tool it performs
 * exactly the retrieval/expansion the offline pipeline performs.
 */
export function createRagTools(stores: AppStores) {
  const retrieveTool = createTool({
    id: 'retrieve',
    description:
      'Retrieve the most relevant document chunks for a query using dense vector similarity over the ingested corpus.',
    inputSchema: z.object({
      query: z.string().describe('The natural-language query to retrieve context for.'),
      topK: z.number().int().min(1).max(20).default(6).describe('How many chunks to return.'),
    }),
    outputSchema: z.object({
      citations: z.array(CitationSchema),
    }),
    execute: async ({ context }) => {
      return { citations: await retrieveContext(stores, context.query, context.topK) };
    },
  });

  const graphExpandTool = createTool({
    id: 'graphExpand',
    description:
      'Expand a set of seed entities along knowledge-graph edges to surface related entities and the relations connecting them.',
    inputSchema: z.object({
      entityIds: z.array(z.string()).describe('Seed entity ids to expand from.'),
      depth: z.number().int().min(1).max(3).default(1).describe('Hop distance to expand.'),
    }),
    outputSchema: z.object({
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema),
    }),
    execute: async ({ context }) => {
      return expandGraph(stores, context.entityIds, context.depth);
    },
  });

  return { retrieveTool, graphExpandTool };
}
