import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import type {
  Answer,
  Citation,
  Entity,
  QueryEvent,
  QueryRequest,
  Relation,
  ThoughtPhase,
  ThoughtStatus,
  ThoughtStep,
} from '@kg/shared';
import type { AppStores } from '../services/stores.js';
import { createRagTools } from './tools.js';

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
export function createRagAgent(stores: AppStores): Agent {
  const { retrieveTool, graphExpandTool } = createRagTools(stores);

  // `@mastra/core`'s `Agent` requires a bound model. Binding a *real* provider
  // would need an API key at import and break offline operation, so we bind a
  // placeholder AI SDK model that is never invoked: `runRagQuery` drives
  // generation through the pluggable provider instead. In a keyed deployment
  // you'd swap this for e.g. `openai('gpt-4o')` and call `agent.generate(...)`.
  const offlineModel = {
    specificationVersion: 'v1',
    provider: 'kg-offline',
    modelId: 'offline-placeholder',
    defaultObjectGenerationMode: undefined,
    doGenerate: () => {
      throw new Error('Offline placeholder model invoked — bind a real model to use agent.generate().');
    },
    doStream: () => {
      throw new Error('Offline placeholder model invoked — bind a real model to use agent.generate().');
    },
  };

  const agentConfig = {
    name: 'kg-rag-explorer',
    model: offlineModel,
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
    await endStep(
      emit,
      planStep,
      'plan',
      'Planning retrieval',
      `Agent "${agentName}" will retrieve top-${req.topK} chunks` +
        `${req.useGraphExpansion ? ' and expand the knowledge graph' : ''}.`,
    );

    // 2. RETRIEVE ---------------------------------------------------------
    const retrieveStep = await beginStep(emit, 'retrieve', 'Retrieving context');
    const [queryEmbedding] = await stores.provider.embed([req.question]);
    const hits = stores.vectorStore.search(queryEmbedding ?? [], req.topK);
    const documents = new Map(stores.corpus.listDocuments().map((d) => [d.id, d]));
    const citations: Citation[] = hits.map((hit) => ({
      chunkId: hit.chunk.id,
      documentId: hit.chunk.documentId,
      documentTitle: documents.get(hit.chunk.documentId)?.title ?? hit.chunk.documentId,
      snippet: hit.chunk.text.slice(0, 280),
      score: hit.score,
    }));
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

      const entityMap = new Map<string, Entity>();
      const relationMap = new Map<string, Relation>();
      for (const id of seedIds) {
        const sub = stores.graphStore.neighbors(id, 1);
        for (const e of sub.entities) entityMap.set(e.id, e);
        for (const r of sub.relations) relationMap.set(r.id, r);
      }
      usedEntities.push(...entityMap.values());
      usedRelations.push(...relationMap.values());

      await emit({ type: 'graph', entities: usedEntities, relations: usedRelations });
      await endStep(
        emit,
        graphStep,
        'graph-expand',
        'Expanding knowledge graph',
        `Traversed ${usedEntities.length} entit(ies) and ${usedRelations.length} relation(s).`,
      );
    }

    // 4. SYNTHESIZE -------------------------------------------------------
    const synthStep = await beginStep(emit, 'synthesize', 'Synthesizing answer');
    const contextParts: string[] = citations.map((c) => c.snippet);
    if (usedEntities.length > 0) {
      const entityLine =
        'Key entities: ' + usedEntities.map((e) => e.label).slice(0, 12).join(', ') + '.';
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
      citations,
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
