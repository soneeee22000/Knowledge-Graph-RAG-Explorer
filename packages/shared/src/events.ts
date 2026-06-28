import { z } from 'zod';
import { AnswerSchema, CitationSchema, EntitySchema, RelationSchema } from './domain.js';

/**
 * Streaming protocol contracts.
 *
 * The agent's "thought process" is streamed to the UI over SSE so that the
 * reasoning is transparent and intuitive (the JD's core requirement). Every
 * event is a discriminated union member keyed by `type`, so the frontend can
 * exhaustively switch over them with full type safety.
 */

export const ThoughtStatusSchema = z.enum(['running', 'done', 'error']);
export type ThoughtStatus = z.infer<typeof ThoughtStatusSchema>;

/** The ordered phases of the agentic RAG pipeline. */
export const ThoughtPhaseSchema = z.enum([
  'plan',
  'retrieve',
  'graph-expand',
  'rerank',
  'synthesize',
]);
export type ThoughtPhase = z.infer<typeof ThoughtPhaseSchema>;

/** A discrete reasoning step the agent took, surfaced live in the UI. */
export const ThoughtStepSchema = z.object({
  id: z.string(),
  phase: ThoughtPhaseSchema,
  title: z.string(),
  detail: z.string().default(''),
  status: ThoughtStatusSchema,
  /** Wall-clock duration in ms, set when the step finishes. */
  durationMs: z.number().nonnegative().optional(),
});
export type ThoughtStep = z.infer<typeof ThoughtStepSchema>;

/* ------------------------------------------------------------------ */
/* Query (RAG) stream events                                          */
/* ------------------------------------------------------------------ */

export const QueryEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thought'), step: ThoughtStepSchema }),
  z.object({
    type: z.literal('retrieved'),
    citations: z.array(CitationSchema),
  }),
  z.object({
    type: z.literal('graph'),
    entities: z.array(EntitySchema),
    relations: z.array(RelationSchema),
  }),
  /** Incremental answer token for typewriter rendering. */
  z.object({ type: z.literal('token'), value: z.string() }),
  z.object({ type: z.literal('answer'), answer: AnswerSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
]);
export type QueryEvent = z.infer<typeof QueryEventSchema>;

/* ------------------------------------------------------------------ */
/* Ingestion stream events                                            */
/* ------------------------------------------------------------------ */

export const IngestPhaseSchema = z.enum([
  'chunking',
  'embedding',
  'extracting',
  'linking',
  'persisting',
]);
export type IngestPhase = z.infer<typeof IngestPhaseSchema>;

export const IngestEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    phase: IngestPhaseSchema,
    message: z.string(),
    /** Completion ratio in [0, 1]. */
    ratio: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('complete'),
    documentId: z.string(),
    chunkCount: z.number().int().nonnegative(),
    entityCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type IngestEvent = z.infer<typeof IngestEventSchema>;

/** Serialize an event as a single SSE `data:` frame. */
export function toSseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
