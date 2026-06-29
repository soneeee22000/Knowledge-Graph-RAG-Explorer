import type { EntityType } from '@kg/shared';
import { embedText } from './mock.js';
import type { GraphExtraction, LlmProvider } from './provider.js';

/**
 * BAML-backed provider.
 *
 * Extraction and answering are real BAML functions (`ExtractKnowledgeGraph`,
 * `AnswerQuestion` in `packages/baml/baml_src`), executed through the generated
 * typed client with automatic Claude → GPT-4o → Mistral fallback.
 *
 * Embeddings are NOT an LLM function — BAML covers structured generation, not
 * vector embedding — so we reuse the same deterministic local embedder as the
 * mock provider. This keeps retrieval consistent across providers; swap in a
 * real embedding model (e.g. text-embedding-3) here for production.
 *
 * The generated client (`@kg/baml`) is TypeScript-only and may not exist until
 * `npm run baml:generate` has run. We `await import()` it lazily (only when a
 * real model is actually used) and surface a clear, actionable error if it's
 * missing. The API bundle force-includes `@kg/baml` (see `tsup.config.ts`) so
 * the compiled `node dist` runtime can load it without a TS loader.
 */
export class BamlLlmProvider implements LlmProvider {
  readonly name = 'baml';

  private clientPromise: Promise<BamlClientLike> | undefined;

  private client(): Promise<BamlClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = loadBamlClient();
    }
    return this.clientPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedText(t));
  }

  async extractGraph(chunkText: string): Promise<GraphExtraction> {
    const b = await this.client();
    const raw = (await b.ExtractKnowledgeGraph(chunkText)) as RawBamlGraph;
    return normalizeBamlGraph(raw);
  }

  async answer(question: string, context: string): Promise<string> {
    const b = await this.client();
    const result = (await b.AnswerQuestion(question, context)) as RawGroundedAnswer;
    return (result.answer ?? '').trim();
  }
}

/* ------------------------------------------------------------------ */
/* Dynamic loading                                                     */
/* ------------------------------------------------------------------ */

/** The two BAML functions this provider relies on (see baml_src). */
interface BamlClientLike {
  ExtractKnowledgeGraph: (chunk: string) => Promise<unknown>;
  AnswerQuestion: (question: string, context: string) => Promise<unknown>;
}

interface RawGroundedAnswer {
  answer?: string;
  used_entities?: string[];
  confidence?: number;
}

interface RawBamlGraph {
  entities?: Array<{ name?: string; type?: string; description?: string }>;
  relations?: Array<{ source?: string; target?: string; type?: string; label?: string }>;
}

/**
 * Load the generated BAML client.
 *
 * The default `Primary` client is a `fallback` over Claude → GPT-4o → Mistral.
 * BAML resolves every member's `api_key` when the fallback client is built, so
 * an *unset* `OPENAI_API_KEY` / `MISTRAL_API_KEY` aborts the whole chain even
 * though Claude (first, and the only key most users set) would succeed. We
 * default those optional keys to empty so the fallback initializes and Claude
 * is used; supply real keys to make the GPT-4o / Mistral legs functional.
 */
async function loadBamlClient(): Promise<BamlClientLike> {
  process.env.OPENAI_API_KEY ??= '';
  process.env.MISTRAL_API_KEY ??= '';
  try {
    // Static specifier so the bundler can inline the TS-only client (tsup
    // `noExternal`); resolves via the workspace symlink under tsx in dev.
    const mod = (await import('@kg/baml')) as Record<string, unknown>;
    // The generated client exposes a `b` singleton of function handles.
    const client = (mod.b ?? mod.default ?? mod) as BamlClientLike;
    if (typeof client.ExtractKnowledgeGraph === 'function') return client;
    throw new Error('generated @kg/baml client is missing ExtractKnowledgeGraph');
  } catch (err) {
    throw new Error(
      'BAML client not found. Run `npm run baml:generate` and set ANTHROPIC_API_KEY ' +
        '(optionally OPENAI_API_KEY / MISTRAL_API_KEY for the fallback legs), ' +
        'or set LLM_PROVIDER=mock to run offline. ' +
        `(underlying error: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

const ENTITY_TYPES: ReadonlySet<string> = new Set([
  'person',
  'organization',
  'location',
  'concept',
  'event',
  'product',
  'technology',
  'other',
]);

function coerceType(t: string | undefined): EntityType {
  const lower = t?.toLowerCase();
  return lower && ENTITY_TYPES.has(lower) ? (lower as EntityType) : 'other';
}

/** Map the generated client's output into our local extraction shape. */
function normalizeBamlGraph(raw: RawBamlGraph): GraphExtraction {
  const entities = (raw.entities ?? [])
    .map((e) => ({
      label: (e.name ?? '').trim(),
      type: coerceType(e.type),
      ...(e.description ? { properties: { description: e.description } } : {}),
    }))
    .filter((e) => e.label.length > 0);

  const relations = (raw.relations ?? [])
    .map((r) => ({
      sourceLabel: (r.source ?? '').trim(),
      targetLabel: (r.target ?? '').trim(),
      type: r.type ?? 'RELATED_TO',
      label: r.label ?? 'related to',
      weight: 0.6,
    }))
    .filter((r) => r.sourceLabel.length > 0 && r.targetLabel.length > 0);

  return { entities, relations };
}
