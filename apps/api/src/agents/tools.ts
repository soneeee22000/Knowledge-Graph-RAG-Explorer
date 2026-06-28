import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CitationSchema, EntitySchema, RelationSchema } from '@kg/shared';
import type { AppStores } from '../services/stores.js';

/**
 * Mastra tool definitions for the RAG agent.
 *
 * These are genuine `createTool` definitions with zod input/output schemas so
 * the Mastra Agent documents an autonomous plan→retrieve→expand→synthesize
 * flow. They are bound to the live stores via a factory so a single agent can
 * be instantiated per request against shared state. The orchestration service
 * (`runRagQuery`) drives the same store methods directly so the pipeline runs
 * fully offline with the mock provider (no model call required).
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
      const { query, topK } = context;
      const [embedding] = await stores.provider.embed([query]);
      const hits = stores.vectorStore.search(embedding ?? [], topK);
      const documents = new Map(stores.corpus.listDocuments().map((d) => [d.id, d]));
      const citations = hits.map((hit) => ({
        chunkId: hit.chunk.id,
        documentId: hit.chunk.documentId,
        documentTitle: documents.get(hit.chunk.documentId)?.title ?? hit.chunk.documentId,
        snippet: hit.chunk.text.slice(0, 280),
        score: hit.score,
      }));
      return { citations };
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
      const { entityIds, depth } = context;
      const entityMap = new Map<string, z.infer<typeof EntitySchema>>();
      const relationMap = new Map<string, z.infer<typeof RelationSchema>>();
      for (const id of entityIds) {
        const sub = stores.graphStore.neighbors(id, depth);
        for (const e of sub.entities) entityMap.set(e.id, e);
        for (const r of sub.relations) relationMap.set(r.id, r);
      }
      return { entities: [...entityMap.values()], relations: [...relationMap.values()] };
    },
  });

  return { retrieveTool, graphExpandTool };
}
