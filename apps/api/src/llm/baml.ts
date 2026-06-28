import type { EntityType } from '@kg/shared';
import type { GraphExtraction, LlmProvider } from './provider.js';

/**
 * BAML-backed provider.
 *
 * The generated BAML client (`@kg/baml` / `packages/baml/baml_client`) may not
 * exist until `npm run baml:generate` has been run, so we NEVER statically
 * import it — that would break `tsc`/`tsup` in a fresh checkout. Instead we
 * lazily `await import()` it behind try/catch and surface a clear, actionable
 * error if it's missing or unconfigured.
 *
 * The exact shape of the generated client depends on the .baml definitions the
 * maintainer writes, so the calls below are written defensively and documented;
 * verify the function names against your `baml_src` when wiring real keys.
 */
export class BamlLlmProvider implements LlmProvider {
  readonly name = 'baml';

  // Cached, dynamically-imported client (typed loosely on purpose).
  private clientPromise: Promise<BamlClientLike> | undefined;

  private async client(): Promise<BamlClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = loadBamlClient();
    }
    return this.clientPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const b = await this.client();
    if (typeof b.Embed !== 'function') {
      throw new Error(
        'BAML client has no `Embed` function. Add an embedding function to your baml_src or use LLM_PROVIDER=mock.',
      );
    }
    const out = await Promise.all(texts.map((t) => b.Embed!(t)));
    return out.map((v) => v as number[]);
  }

  async extractGraph(chunkText: string): Promise<GraphExtraction> {
    const b = await this.client();
    if (typeof b.ExtractGraph !== 'function') {
      throw new Error(
        'BAML client has no `ExtractGraph` function. Add it to your baml_src or use LLM_PROVIDER=mock.',
      );
    }
    const raw = (await b.ExtractGraph(chunkText)) as RawBamlGraph;
    return normalizeBamlGraph(raw);
  }

  async answer(question: string, context: string): Promise<string> {
    const b = await this.client();
    if (typeof b.Answer !== 'function') {
      throw new Error(
        'BAML client has no `Answer` function. Add it to your baml_src or use LLM_PROVIDER=mock.',
      );
    }
    return (await b.Answer(question, context)) as string;
  }
}

/* ------------------------------------------------------------------ */
/* Dynamic loading                                                     */
/* ------------------------------------------------------------------ */

/** Loosely-typed view of whatever the generated client exposes. */
interface BamlClientLike {
  Embed?: (text: string) => Promise<unknown>;
  ExtractGraph?: (text: string) => Promise<unknown>;
  Answer?: (question: string, context: string) => Promise<unknown>;
}

interface RawBamlGraph {
  entities?: Array<{ label?: string; name?: string; type?: string; properties?: Record<string, string> }>;
  relations?: Array<{
    sourceLabel?: string;
    source?: string;
    targetLabel?: string;
    target?: string;
    type?: string;
    label?: string;
    weight?: number;
  }>;
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
      // The generated client commonly exposes a `b` singleton.
      const client = (mod.b ?? mod.default ?? mod) as BamlClientLike;
      return client;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'BAML client not found. Run `npm run baml:generate` and set ANTHROPIC_API_KEY/OPENAI_API_KEY, ' +
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
  return t && ENTITY_TYPES.has(t) ? (t as EntityType) : 'other';
}

/** Map the generated client's loose output into our local extraction shape. */
function normalizeBamlGraph(raw: RawBamlGraph): GraphExtraction {
  const entities = (raw.entities ?? [])
    .map((e) => ({
      label: (e.label ?? e.name ?? '').trim(),
      type: coerceType(e.type),
      properties: e.properties,
    }))
    .filter((e) => e.label.length > 0);

  const relations = (raw.relations ?? [])
    .map((r) => ({
      sourceLabel: (r.sourceLabel ?? r.source ?? '').trim(),
      targetLabel: (r.targetLabel ?? r.target ?? '').trim(),
      type: r.type ?? 'RELATED_TO',
      label: r.label ?? 'related to',
      weight: typeof r.weight === 'number' ? r.weight : 0.5,
    }))
    .filter((r) => r.sourceLabel.length > 0 && r.targetLabel.length > 0);

  return { entities, relations };
}
