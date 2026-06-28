# @kg/web — Knowledge-Graph RAG Explorer (frontend)

A high-craft Vue 3 frontend for agentic, graph-augmented retrieval. Paste a
document, watch entities and relations materialize on an interactive VueFlow
canvas, then ask questions and follow the agent's reasoning live as it plans,
retrieves, expands the graph, and synthesizes a cited answer.

## Stack

- **Vue 3** (Composition API, `<script setup lang="ts">`) + **TypeScript strict**
- **Vite** build tooling, **Pinia** state
- **@vue-flow/core** (+ background, controls, minimap) for the graph canvas
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **vitest** + `@vue/test-utils` + `jsdom`, typecheck via `vue-tsc`

All cross-boundary types are imported from `@kg/shared` (Zod schemas + inferred
types); SSE frames are validated against those schemas at the boundary.

## Commands

> The root maintainer installs dependencies (`npm install` at the repo root).

```bash
npm run dev        # Vite dev server (default http://localhost:5173)
npm run build      # vue-tsc --noEmit && vite build
npm run preview    # preview the production build
npm run typecheck  # vue-tsc --noEmit
npm run test       # vitest run
```

## Configuration

Copy `.env.example` to `.env` and set the backend base URL:

```
VITE_API_URL=http://localhost:8000
```

## Architecture

```
src/
  lib/
    apiClient.ts      REST wrappers + streamSse<T>() async-generator SSE helper
    entityVisuals.ts  deterministic color/glyph palette per entity type
    sampleCorpus.ts   built-in "Load sample" passage
  stores/
    corpus.ts   documents + ingest SSE (live phase/progress) + reset
    graph.ts    KnowledgeGraph -> VueFlow nodes/edges, radial layout, highlights
    chat.ts     query SSE -> thought timeline, streamed tokens, citations, graph sync
  components/
    KnowledgeGraphCanvas.vue  VueFlow canvas (Background/Controls/MiniMap)
    EntityNode.vue            custom node: colored by type, sized by salience, glows when cited
    IngestPanel.vue           composer, live ingest progress, doc list, reset
    AgentThoughtTimeline.vue  animated vertical reasoning timeline
    AnswerCard.vue            typewriter answer + citations + entity chips
    ChatPanel.vue             question box (Enter to send) + topK / graph-expansion knobs
    AppHeader.vue             product title + backend health indicator
  App.vue   3-pane responsive shell
  main.ts   app + Pinia bootstrap
```

## API contract consumed

- `GET /api/health` → `HealthResponse`
- `GET /api/documents` → `DocumentListResponse`
- `GET /api/graph` → `KnowledgeGraph`
- `POST /api/ingest` → SSE stream of `IngestEvent` (body `IngestRequest`)
- `POST /api/query` → SSE stream of `QueryEvent` (body `QueryRequest`)
- `DELETE /api/corpus` → 204

SSE frames are `data: <json>\n\n`; POST streams are read via
`fetch().body.getReader()` + `TextDecoder`, buffered, split on `\n\n`, and
validated with the `@kg/shared` zod schemas.
