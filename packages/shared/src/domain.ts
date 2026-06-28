import { z } from 'zod';

/**
 * Core domain contracts for the Knowledge-Graph RAG Explorer.
 *
 * These Zod schemas are the single source of truth shared between the
 * Node/TS backend (Mastra agents, BAML extraction) and the Vue 3 frontend.
 * Validate at every boundary; infer the TS types from the schemas so the
 * "agent <-> human" protocol can never drift.
 */

/** ISO-8601 timestamp string. */
export const IsoDateTime = z.string().datetime();

/** A node in the knowledge graph. Entities are extracted from document chunks. */
export const EntityTypeSchema = z.enum([
  'person',
  'organization',
  'location',
  'concept',
  'event',
  'product',
  'technology',
  'other',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  /** Human-readable canonical name, e.g. "Mastra AI". */
  label: z.string().min(1),
  type: EntityTypeSchema,
  /** Free-form key/value attributes surfaced by extraction. */
  properties: z.record(z.string()).default({}),
  /** Chunks this entity was mentioned in (provenance for citations). */
  sourceChunkIds: z.array(z.string()).default([]),
  /** Graph centrality score in [0, 1]; higher = more connected. */
  salience: z.number().min(0).max(1).default(0),
});
export type Entity = z.infer<typeof EntitySchema>;

/** A directed, typed edge between two entities. */
export const RelationSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  /** Machine label, e.g. "FOUNDED_BY", "PART_OF". */
  type: z.string().min(1),
  /** Human label, e.g. "founded by". */
  label: z.string().min(1),
  /** Confidence / strength in [0, 1]. */
  weight: z.number().min(0).max(1).default(0.5),
  sourceChunkIds: z.array(z.string()).default([]),
});
export type Relation = z.infer<typeof RelationSchema>;

export const KnowledgeGraphSchema = z.object({
  entities: z.array(EntitySchema),
  relations: z.array(RelationSchema),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

/** A source document ingested into the corpus. */
export const DocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Origin label (filename, URL, "pasted"). */
  source: z.string().min(1),
  /** Number of chunks produced. */
  chunkCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type Document = z.infer<typeof DocumentSchema>;

/** A retrievable text chunk with an embedding. */
export const ChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  /** Order within the parent document. */
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  /** Dense embedding vector; omitted on the wire to keep payloads small. */
  embedding: z.array(z.number()).optional(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

/** A single retrieval hit used to ground an answer. */
export const CitationSchema = z.object({
  chunkId: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  snippet: z.string(),
  /** Similarity score in [0, 1]. */
  score: z.number().min(0).max(1),
});
export type Citation = z.infer<typeof CitationSchema>;

/** The grounded answer returned by the agent. */
export const AnswerSchema = z.object({
  text: z.string(),
  citations: z.array(CitationSchema),
  /** Entity ids the agent traversed while reasoning. */
  usedEntityIds: z.array(z.string()).default([]),
  /** Relation ids the agent traversed while reasoning. */
  usedRelationIds: z.array(z.string()).default([]),
});
export type Answer = z.infer<typeof AnswerSchema>;
