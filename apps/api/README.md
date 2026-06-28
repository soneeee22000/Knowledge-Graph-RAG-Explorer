# @kg/api — Knowledge-Graph RAG Explorer (Backend)

Fastify + Mastra backend for agentic RAG over an interactive knowledge graph.
It ingests documents, builds a vector index and a knowledge graph, and answers
questions by retrieving relevant chunks, expanding the graph, and synthesizing a
grounded answer — streaming every reasoning step over SSE.

**Runs fully offline with no API keys** via a deterministic mock LLM provider.

## Stack

- Node.js >= 20, TypeScript (strict), ESM only.
- [Fastify](https://fastify.dev) for HTTP + SSE, `@fastify/cors`.
- [Mastra](https://mastra.ai) (`@mastra/core`) — the RAG `Agent` + `createTool` tools.
- [graphology](https://graphology.github.io) (+ `graphology-metrics`) for the knowledge graph.
- [zod](https://zod.dev) for validation (shapes imported from `@kg/shared`).
- Dev `tsx`, build `tsup`, test `vitest`.

## Quick start

```bash
# from the monorepo root (installs all workspaces)
npm install

# dev server (port 8000 by default)
npm run dev --workspace @kg/api

# or, within apps/api
npm run dev        # tsx watch
npm run build      # tsup → dist/
npm start          # node dist/index.js
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

## Environment variables

Copy `.env.example` → `.env` (all values have defaults; the app boots without any).

| Var                 | Default     | Description                                         |
| ------------------- | ----------- | --------------------------------------------------- |
| `PORT`              | `8000`      | HTTP port.                                          |
| `HOST`              | `0.0.0.0`   | Bind host.                                           |
| `LLM_PROVIDER`      | `mock`      | `mock` (offline) or `baml` (needs keys + client).   |
| `DATA_DIR`          | `./data`    | Where `vectors.json`, `graph.json`, `documents.json` are persisted. |
| `CORS_ORIGIN`       | `*`         | Comma-separated origins, or `*`.                    |
| `ANTHROPIC_API_KEY` | _(unset)_   | Only used by the `baml` provider.                   |
| `OPENAI_API_KEY`    | _(unset)_   | Only used by the `baml` provider.                   |

## Provider abstraction

The pipeline is written against the `LlmProvider` interface
(`src/llm/provider.ts`) with three methods: `embed`, `extractGraph`, `answer`.

- **`MockLlmProvider`** (`src/llm/mock.ts`, default) — deterministic, offline.
  Hash-based L2-normalized embeddings, heuristic capitalized-phrase + keyword
  entity extraction with co-occurrence relations, and extractive answers that
  stitch the most relevant context sentences.
- **`BamlLlmProvider`** (`src/llm/baml.ts`) — dynamically `import()`s the
  generated BAML client (`@kg/baml` / `packages/baml/baml_client`) at runtime
  inside try/catch. If absent it throws a clear error asking you to run
  `npm run baml:generate` and set keys. It is **never** statically imported, so
  `tsc`/`tsup` stay green in a fresh checkout.

Selected by `LLM_PROVIDER` via the factory in `src/llm/index.ts`.

### Mastra usage & offline note

`src/agents/ragAgent.ts` defines a real `@mastra/core` `Agent` named
`kg-rag-explorer` with instructions describing the
plan → retrieve → graph-expand → synthesize flow, and registers two real
`createTool` tools (`src/agents/tools.ts`): `retrieve` and `graphExpand`.

Because `Agent.generate` normally needs a bound model, the offline pipeline
driver `runRagQuery` executes the same tools/provider deterministically so the
whole system works with the mock. No API key is required at import time.

## API (prefix `/api`)

All request/response/event shapes come from `@kg/shared` (the single source of
truth). SSE frames are serialized with `toSseFrame`.

| Method & path        | Body            | Response                                                            |
| -------------------- | --------------- | ------------------------------------------------------------------ |
| `GET /api/health`    | —               | `HealthResponse` `{status, llmProvider, documentCount, entityCount}` |
| `GET /api/documents` | —               | `DocumentListResponse`                                             |
| `GET /api/graph`     | —               | `KnowledgeGraph` (full current graph)                              |
| `POST /api/ingest`   | `IngestRequest` | **SSE** stream of `IngestEvent` (progress…/complete or error)      |
| `POST /api/query`    | `QueryRequest`  | **SSE** stream of `QueryEvent` (thought/retrieved/graph/token/answer/done) |
| `DELETE /api/corpus` | —               | `204`; clears all stores + persisted JSON files                    |

SSE responses set `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`, and flush per frame. Invalid bodies return `400` with
an `ApiError` envelope.

### Examples

```bash
# Ingest (streams progress)
curl -N -X POST localhost:8000/api/ingest \
  -H 'content-type: application/json' \
  -d '{"title":"Mastra","source":"docs","content":"Mastra AI builds an agent framework in TypeScript. It integrates with BAML."}'

# Query (streams reasoning + answer)
curl -N -X POST localhost:8000/api/query \
  -H 'content-type: application/json' \
  -d '{"question":"What does Mastra build?","topK":6,"useGraphExpansion":true}'

curl localhost:8000/api/health
curl localhost:8000/api/graph
curl -X DELETE localhost:8000/api/corpus
```

## Layout

```
src/
  config.ts            # zod-validated env
  index.ts             # entry point (starts the server)
  server.ts            # buildServer(): Fastify app + CORS + routes + stores
  routes/index.ts      # REST + SSE routes (/api)
  llm/                 # provider interface, mock, baml, factory
  services/            # chunker, vectorStore, graphStore, corpus, stores
  agents/              # Mastra agent + tools + runRagQuery pipeline
```

Persisted artifacts live in `DATA_DIR` and are gitignored at the repo root.
```
