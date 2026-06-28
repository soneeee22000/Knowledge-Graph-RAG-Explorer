import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import type {
  Answer,
  Entity,
  QueryEvent,
  QueryRequest,
  Relation,
  ThoughtPhase,
  ThoughtStatus,
  ThoughtStep,
} from '@kg/shared';
import { config } from '../config.js';
import type { AppStores } from '../services/stores.js';
import { createRagTools, expandGraph, retrieveContext } from './tools.js';

/** Async sink for streamed query events. */
export type QueryEmit = (event: QueryEvent) => void | Promise<void>;

/**
 * The Mastra agent definition.
 *
 * This is a real, well-formed `@mastra/core` Agent: it carries instructions
 * describing the agentic RAG flow and registers the two tools. In a keyed
 * deployment you'd call `agent.generate(...)` and let it autonomously invoke
 * the tools; offline we keep the definition for documentation/skill purposes
 * and drive the same tools/provider deterministically in `runRagQuery`.
 *
 * No model is bound here, so importing this module never requires an API key.
 */
export function createRagAgent(stores: AppStores, model?: unknown): Agent {
  const { retrieveTool, graphExpandTool } = createRagTools(stores);

  // `@mastra/core`'s `Agent` requires a bound model. Offline we bind a
  // placeholder AI SDK model that is never invoked; with a real key (see
  // `generateAgentPlan`) a genuine Anthropic model is passed in and
  // `agent.generate(...)` is actually called.
  const offlineModel = {
    specificationVersion: 'v1',
    provider: 'kg-offline',
    modelId: 'offline-placeholder',
    defaultObjectGenerationMode: undefined,
    doGenerate: () => {
      throw new Error(
        'Offline placeholder model invoked — bind a real model to use agent.generate().',
      );
    },
    doStream: () => {
      throw new Error(
        'Offline placeholder model invoked — bind a real model to use agent.generate().',
      );
    },
  };

  const agentConfig = {
    name: 'kg-rag-explorer',
    model: model ?? offlineModel,
    instructions: [
      'You are a knowledge-graph-augmented RAG agent.',
      'Follow this flow for every question:',
      '1. PLAN: restate the question and decide what to retrieve.',
      '2. RETRIEVE: call the `retrieve` tool to fetch the most relevant chunks as citations.',
      '3. GRAPH-EXPAND: map retrieved chunks to seed entities and call `graphExpand` to traverse related entities/relations.',
      '4. SYNTHESIZE: write a concise, grounded answer citing the retrieved chunks and naming the entities you traversed.',
      'Never invent facts that are not supported by the retrieved context.',
    ].join('\n'),
    tools: { retrieve: retrieveTool, graphExpand: graphExpandTool },
  };

  return new Agent(agentConfig as unknown as ConstructorParameters<typeof Agent>[0]);
}

/**
 * When a real key is configured (`LLM_PROVIDER=baml` + `ANTHROPIC_API_KEY`),
 * bind a real Anthropic model and run a genuine Mastra `agent.generate()` to
 * produce the retrieval plan — the agent may autonomously invoke its registered
 * tools. Returns `null` offline so the deterministic pipeline supplies the plan,
 * and on any failure so a model/SDK hiccup never breaks a query.
 */
async function generateAgentPlan(stores: AppStores, question: string): Promise<string | null> {
  if (config.LLM_PROVIDER !== 'baml' || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { anthropic } = await import('@ai-sdk/anthropic');
    const agent = createRagAgent(stores, anthropic('claude-sonnet-4-6'));
    const result = await agent.generate(
      `State a brief retrieval plan (one or two sentences) for answering: "${question}"`,
    );
    const text = result.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.warn(
      'Mastra agent.generate plan unavailable; using deterministic plan:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic pipeline driver                                       */
/* ------------------------------------------------------------------ */

interface StepHandle {
  id: string;
  startedAt: number;
}

function beginStep(
  emit: QueryEmit,
  phase: ThoughtPhase,
  title: string,
  detail = '',
): Promise<StepHandle> {
  const handle: StepHandle = { id: `step_${randomUUID()}`, startedAt: Date.now() };
  const step: ThoughtStep = { id: handle.id, phase, title, detail, status: 'running' };
  return Promise.resolve(emit({ type: 'thought', step })).then(() => handle);
}

function endStep(
  emit: QueryEmit,
  handle: StepHandle,
  phase: ThoughtPhase,
  title: string,
  detail: string,
  status: ThoughtStatus = 'done',
): void | Promise<void> {
  const step: ThoughtStep = {
    id: handle.id,
    phase,
    title,
    detail,
    status,
    durationMs: Date.now() - handle.startedAt,
  };
  return emit({ type: 'thought', step });
}

/** Split answer text into small streamable tokens (word-ish granularity). */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

/**
 * Execute the agentic RAG pipeline, emitting a `QueryEvent` for each step.
 * Mirrors the Mastra agent's documented flow but runs deterministically with
 * the configured provider so it works offline.
 */
export async function runRagQuery(
  stores: AppStores,
  req: QueryRequest,
  emit: QueryEmit,
): Promise<void> {
  try {
    // 1. PLAN -------------------------------------------------------------
    // Instantiate the Mastra agent so its tools/instructions are constructed
    // and validated for this request; the offline pipeline below executes the
    // same retrieve → graph-expand → synthesize flow deterministically. Agent
    // construction is best-effort: if a future Mastra version rejects the
    // offline model, the deterministic pipeline still runs.
    let agentName = 'kg-rag-explorer';
    try {
      agentName = createRagAgent(stores).name;
    } catch (err) {
      console.warn(
        'Mastra agent construction skipped:',
        err instanceof Error ? err.message : String(err),
      );
    }
    const planStep = await beginStep(emit, 'plan', 'Planning retrieval');
    const agentPlan = await generateAgentPlan(stores, req.question);
    await endStep(
      emit,
      planStep,
      'plan',
      'Planning retrieval',
      agentPlan ??
        `Agent "${agentName}" will retrieve top-${req.topK} chunks` +
          `${req.useGraphExpansion ? ' and expand the knowledge graph' : ''}.`,
    );

    // 2. RETRIEVE ---------------------------------------------------------
    const retrieveStep = await beginStep(emit, 'retrieve', 'Retrieving context');
    const citations = await retrieveContext(stores, req.question, req.topK);
    await emit({ type: 'retrieved', citations });
    await endStep(
      emit,
      retrieveStep,
      'retrieve',
      'Retrieving context',
      `Retrieved ${citations.length} chunk(s).`,
    );

    // 3. GRAPH-EXPAND -----------------------------------------------------
    const usedEntities: Entity[] = [];
    const usedRelations: Relation[] = [];
    if (req.useGraphExpansion) {
      const graphStep = await beginStep(emit, 'graph-expand', 'Expanding knowledge graph');
      // Seed entities = entities whose provenance includes a retrieved chunk.
      const retrievedChunkIds = new Set(citations.map((c) => c.chunkId));
      const fullGraph = stores.graphStore.toKnowledgeGraph();
      const seedIds = fullGraph.entities
        .filter((e) => e.sourceChunkIds.some((id) => retrievedChunkIds.has(id)))
        .map((e) => e.id);

      const expanded = expandGraph(stores, seedIds, 1);
      usedEntities.push(...expanded.entities);
      usedRelations.push(...expanded.relations);

      await emit({ type: 'graph', entities: usedEntities, relations: usedRelations });
      await endStep(
        emit,
        graphStep,
        'graph-expand',
        'Expanding knowledge graph',
        `Traversed ${usedEntities.length} entit(ies) and ${usedRelations.length} relation(s).`,
      );
    }

    // 4. RERANK (graph-aware) --------------------------------------------
    // Boost chunks that contributed an entity surfaced during graph expansion,
    // so graph-connected evidence floats to the top before synthesis.
    let rankedCitations = citations;
    if (req.useGraphExpansion && usedEntities.length > 0) {
      const rerankStep = await beginStep(emit, 'rerank', 'Reranking by graph signal');
      const GRAPH_BOOST = 0.15;
      const boostedChunkIds = new Set(usedEntities.flatMap((e) => e.sourceChunkIds));
      const boosted = (c: (typeof citations)[number]): number =>
        c.score + (boostedChunkIds.has(c.chunkId) ? GRAPH_BOOST : 0);
      rankedCitations = [...citations].sort((a, b) => boosted(b) - boosted(a));
      const boostedCount = citations.filter((c) => boostedChunkIds.has(c.chunkId)).length;
      await emit({ type: 'retrieved', citations: rankedCitations });
      await endStep(
        emit,
        rerankStep,
        'rerank',
        'Reranking by graph signal',
        `Boosted ${boostedCount} graph-connected chunk(s).`,
      );
    }

    // 5. SYNTHESIZE -------------------------------------------------------
    const synthStep = await beginStep(emit, 'synthesize', 'Synthesizing answer');
    const contextParts: string[] = rankedCitations.map((c) => c.snippet);
    if (usedEntities.length > 0) {
      const entityLine =
        'Key entities: ' +
        usedEntities
          .map((e) => e.label)
          .slice(0, 12)
          .join(', ') +
        '.';
      contextParts.push(entityLine);
    }
    const context = contextParts.join('\n');
    const answerText = await stores.provider.answer(req.question, context);

    // Stream the answer as tokens for typewriter rendering.
    for (const token of tokenize(answerText)) {
      await emit({ type: 'token', value: token });
    }

    const answer: Answer = {
      text: answerText,
      citations: rankedCitations,
      usedEntityIds: usedEntities.map((e) => e.id),
      usedRelationIds: usedRelations.map((r) => r.id),
    };
    await emit({ type: 'answer', answer });
    await endStep(emit, synthStep, 'synthesize', 'Synthesizing answer', 'Answer ready.');

    await emit({ type: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit({ type: 'error', message });
    await emit({ type: 'done' });
  }
}
