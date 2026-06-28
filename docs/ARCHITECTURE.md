# Architecture

## Overview

The Knowledge-Graph RAG Explorer is an npm-workspaces monorepo with two apps and
two shared packages. The design goal: make an agent's RAG reasoning **transparent
and inspectable** while keeping the whole system **typed end-to-end** and
**runnable offline**.

## Packages

### `packages/shared` — the protocol

Every value that crosses a process boundary is defined once, as a Zod schema, and
re-exported with its inferred TypeScript type:

- `domain.ts` — `Entity`, `Relation`, `KnowledgeGraph`, `Document`, `Chunk`,
  `Citation`, `Answer`.
- `events.ts` — the SSE streaming protocol: `QueryEvent` and `IngestEvent`
  discriminated unions, plus `ThoughtStep`. The frontend exhaustively switches
  over `event.type` with full type safety.
- `api.ts` — REST request/response shapes (`IngestRequest`, `QueryRequest`, …).

Because both the Node backend and the Vue frontend import these schemas, the
"agent ↔ human" contract is enforced at runtime (validation) and compile time
(types). This is the JD's "robust schema contracts" requirement made literal.

### `packages/baml` — typed LLM integration

BAML (BoundaryML) files declare LLM functions as typed contracts:

- `ExtractKnowledgeGraph(chunk) -> GraphExtraction`
- `AnswerQuestion(question, context) -> GroundedAnswer`

`clients.baml` defines a `Primary` fallback chain (Claude → GPT-4o → Mistral).
`npm run baml:generate` emits a typed client the backend loads dynamically. None
of this is required to run — the mock provider implements the same interface.

## Apps

### `apps/api` — Node + TypeScript + Mastra

```
config → server (Fastify) → routes → services / agents → llm provider
```

- **LLM provider abstraction** (`llm/`): a single `LlmProvider` interface with
  `embed`, `extractGraph`, `answer`. `MockLlmProvider` is deterministic and
  offline; `BamlLlmProvider` dynamically loads the generated BAML client. The
  factory picks one from `LLM_PROVIDER`.
- **Ingestion** (`services/corpus.ts`): chunk → embed → extract graph → merge →
  persist, emitting `IngestEvent`s over SSE.
- **Stores**: an in-memory cosine **vector store** and a **graphology** knowledge
  graph (entity dedup + degree-centrality salience), both persisted to JSON.
- **RAG agent** (`agents/`): a Mastra `Agent` with `retrieve` and `graphExpand`
  tools. `runRagQuery` executes plan → retrieve → graph-expand → synthesize,
  emitting a `ThoughtStep` for each phase and streaming answer tokens.

All streaming uses SSE frames (`data: <json>\n\n`) serialized through
`toSseFrame` from `@kg/shared`.

### `apps/web` — Vue 3 + VueFlow

- **Stores** (Pinia): `corpus` (documents + ingestion), `graph` (KnowledgeGraph →
  VueFlow nodes/edges, layout, highlight state), `chat` (questions, streamed
  thought steps, tokens, citations).
- **Canvas** (`KnowledgeGraphCanvas.vue` + `EntityNode.vue`): VueFlow with custom
  nodes colored by entity type and sized by salience; cited entities glow.
- **Transparency** (`AgentThoughtTimeline.vue`): renders streamed `ThoughtStep`s
  as a live timeline so users follow the agent's reasoning.
- **SSE consumption**: because the streams are `POST`, the client reads them via
  `fetch` + `ReadableStream` (`streamSse` async generator), validating each frame
  against the shared Zod schemas.

## Data flow: asking a question

1. UI `POST /api/query` with `{ question, topK, useGraphExpansion }`.
2. API emits `thought(plan)` → embeds the question → vector search.
3. Emits `retrieved` (citations) + `thought(retrieve)`.
4. Maps hits to entities, expands neighbors → emits `graph` + `thought(graph-expand)`.
   The frontend pushes these into the graph store and highlights them.
5. Builds context, calls `provider.answer`, streams `token`s, emits final
   `answer`, then `done`.

## Why offline-first

A portfolio repo must run on `git clone && npm install` with no secrets. The mock
provider produces a genuinely non-trivial graph and grounded extractive answers,
so reviewers see the full experience immediately; real models are one env var
away.
