# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); commits follow Conventional Commits.

## [Unreleased]

### Added

- Retrieval evaluation: an authored 20-question set over a fictional 10-document corpus, comparing graph-expand with vector-only retrieval on the mock provider (`npm run eval`). Results are committed in `apps/api/eval/results.json`, and CI fails if a fresh run differs (`npm run eval:check`).
- `docs/EVAL.md`, `docs/WHY.md` and `docs/DEPLOY.md` (keyless deployment steps, prepared but not executed).
- `vercel.json` (web) and `render.yaml` (API, free plan) for a keyless deploy.

### Changed

- Graph expansion and the graph rerank moved into `apps/api/src/agents/graphRetrieval.ts`, so the app and the evaluation run the same code.
- README rewritten: results, limitations and roadmap added, and the Mastra and rerank claims corrected to match the code.

### Documented

- The graph rerank never changes the top-k order on the evaluation set: every retrieved chunk receives the same boost.

## [0.1.0] - 2026-06-29

### Added

- Initial Knowledge-Graph RAG Explorer: Vue 3 + VueFlow canvas, Fastify API with SSE ingestion and query streams, graphology knowledge graph, in-memory vector store, Zod contracts shared across the stack, keyless mock provider, and BAML provider with Claude, GPT-4o and Mistral fallback.
- Hero screenshot and README badges.

### Fixed

- BAML and Mastra paths made runnable, graph-aware rerank added, CI, Docker and docs fixed (2026-06-28).
- BAML provider runnable from the built bundle and with a single key (2026-06-29).
