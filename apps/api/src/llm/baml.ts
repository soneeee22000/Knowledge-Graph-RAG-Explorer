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
 * The generated client (`@kg/baml`) may not exist until `npm run baml:generate`
 * has run, so we NEVER statically import it (that would break `tsc`/`tsup` in a
 * fresh checkout). We lazily `await import()` it and surface a clear, actionable
 * error if it's missing.
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
 * Try the published package name first, then the in-repo generated path.
 * Both are dynamic so missing files never break the build.
 */
async function loadBamlClient(): Promise<BamlClientLike> {
  const candidates = ['@kg/baml', '@kg/baml/baml_client', '../../../../packages/baml/baml_client'];
  let lastErr: unknown;
  for (const spec of candidates) {
    try {
      const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
      // The generated client exposes a `b` singleton of function handles.
      const client = (mod.b ?? mod.default ?? mod) as BamlClientLike;
      if (typeof client.ExtractKnowledgeGraph === 'function') return client;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'BAML client not found. Run `npm run baml:generate` and set ANTHROPIC_API_KEY/OPENAI_API_KEY/MISTRAL_API_KEY, ' +
      'or set LLM_PROVIDER=mock to run offline. ' +
      `(underlying error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
  );
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
