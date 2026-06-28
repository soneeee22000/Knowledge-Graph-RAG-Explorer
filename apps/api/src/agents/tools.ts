import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  CitationSchema,
  EntitySchema,
  RelationSchema,
  type Citation,
  type Entity,
  type Relation,
} from '@kg/shared';
import type { AppStores } from '../services/stores.js';

/**
 * Shared retrieval logic — the single real implementation behind BOTH the
 * Mastra tools and the orchestration pipeline. Invoking a tool and running the
 * deterministic pipeline therefore execute identical code, so the tools are
 * never decorative.
 */

/** Dense vector retrieval → citations, via the configured provider's embedder. */
export async function retrieveContext(
  stores: AppStores,
  query: string,
  topK: number,
): Promise<Citation[]> {
  const [embedding] = await stores.provider.embed([query]);
  const hits = stores.vectorStore.search(embedding ?? [], topK);
  const documents = new Map(stores.corpus.listDocuments().map((d) => [d.id, d]));
  return hits.map((hit) => ({
    chunkId: hit.chunk.id,
    documentId: hit.chunk.documentId,
    documentTitle: documents.get(hit.chunk.documentId)?.title ?? hit.chunk.documentId,
    snippet: hit.chunk.text.slice(0, 280),
    score: hit.score,
  }));
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
