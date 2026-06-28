import { z } from 'zod';
import { DocumentSchema } from './domain.js';

/**
 * HTTP request/response contracts. The REST surface is intentionally tiny;
 * the interesting work streams over SSE (see events.ts).
 */

export const IngestRequestSchema = z.object({
  title: z.string().min(1).max(200),
  source: z.string().min(1).max(200).default('pasted'),
  content: z.string().min(1).max(200_000),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const QueryRequestSchema = z.object({
  question: z.string().min(1).max(2_000),
  /** How many chunks to retrieve before graph expansion. */
  topK: z.number().int().min(1).max(20).default(6),
  /** Whether to expand retrieval along knowledge-graph edges. */
  useGraphExpansion: z.boolean().default(true),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const DocumentListResponseSchema = z.object({
  documents: z.array(DocumentSchema),
});
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  llmProvider: z.string(),
  documentCount: z.number().int().nonnegative(),
  entityCount: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
