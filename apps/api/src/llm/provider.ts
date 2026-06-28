import type { EntityType } from '@kg/shared';

/**
 * Local, provider-facing extraction shapes.
 *
 * These are intentionally *not* the @kg/shared `Entity`/`Relation` schemas:
 * a provider only knows about the raw text it just read, so it emits lightweight
 * descriptors (no graph ids, no salience). The service layer (graphStore/corpus)
 * is responsible for assigning stable ids, deduping, and mapping these to the
 * shared domain types.
 */
export interface ExtractedEntity {
  /** Canonical surface form, e.g. "Mastra AI". */
  label: string;
  type: EntityType;
  /** Optional free-form attributes surfaced during extraction. */
  properties?: Record<string, string>;
}

export interface ExtractedRelation {
  /** Source entity label (must match an emitted entity label). */
  sourceLabel: string;
  /** Target entity label (must match an emitted entity label). */
  targetLabel: string;
  /** Machine label, e.g. "RELATED_TO". */
  type: string;
  /** Human label, e.g. "related to". */
  label: string;
  /** Confidence / strength in [0, 1]. */
  weight: number;
}

export interface GraphExtraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/**
 * Pluggable LLM provider. The whole pipeline is written against this interface
 * so it can run with a deterministic mock (offline, no keys) or a real BAML
 * client. Nothing here should require network access at import time.
 */
export interface LlmProvider {
  /** Human-readable provider id, surfaced in /api/health. */
  readonly name: string;

  /** Embed a batch of texts into dense, L2-normalized vectors. */
  embed(texts: string[]): Promise<number[][]>;

  /** Extract entities + relations from a single chunk of text. */
  extractGraph(chunkText: string): Promise<GraphExtraction>;

  /** Synthesize a grounded answer from a question and assembled context. */
  answer(question: string, context: string): Promise<string>;
}
