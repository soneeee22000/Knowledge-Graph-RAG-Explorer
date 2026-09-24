# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); commits follow Conventional Commits.

## [Unreleased]

### Added

- Graph-augmented retrieval: expansion now adds candidate chunks outside the vector top-k, and the union is reranked by vector score plus graph support, then cut to k (`augmentWithGraph`). Named constants: `SEED_CHUNK_COUNT = 3`, `HOP_DECAY = 0.5`, `GRAPH_SUPPORT_WEIGHT = 1`; ties go to the better vector rank.
- The evaluation scores three modes (vector-only, graph-expand v1, graph-augmented v2), and adds a separate post-fix stratum of 8 multi-hop questions (`questions-postfix.json`, `results-postfix.json`), both checked by CI.
- Read-only demo mode (`DEMO_READONLY=1`): the rail sample is seeded on boot, ingest and `DELETE /api/corpus` return 403, and a per-IP rate limit applies (`RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`). `/api/health` reports `readOnly`, and the web app hides ingest and reset.
- Vercel Function entry (`api/[...path].ts`, `apps/api/src/vercel.ts`), so the web app and the API can share one Vercel project. The function always runs read-only.
- Retrieval evaluation: an authored 20-question set over a fictional 10-document corpus, comparing graph-expand with vector-only retrieval on the mock provider (`npm run eval`). Results are committed in `apps/api/eval/results.json`, and CI fails if a fresh run differs (`npm run eval:check`).
- `docs/EVAL.md`, `docs/WHY.md` and `docs/DEPLOY.md` (keyless deployment steps, prepared but not executed).
- `vercel.json` (web) and `render.yaml` (API, free plan) for a keyless deploy.

### Changed

- Graph expansion and the graph rerank moved into `apps/api/src/agents/graphRetrieval.ts`, so the app and the evaluation run the same code.
- README rewritten: results, limitations and roadmap added, and the Mastra and rerank claims corrected to match the code.

### Documented

- The graph rerank never changes the top-k order on the evaluation set: every retrieved chunk receives the same boost.
- The rebuilt graph step changes the top-6 on 17 of 20 questions, but on the authored sets it recovers no missing evidence and lowers Hit@1 from 16/20 to 15/20 (MRR 0.900 to 0.875). The diagnosis is in `docs/EVAL.md`.

## [0.1.0] - 2026-06-29

### Added

- Initial Knowledge-Graph RAG Explorer: Vue 3 + VueFlow canvas, Fastify API with SSE ingestion and query streams, graphology knowledge graph, in-memory vector store, Zod contracts shared across the stack, keyless mock provider, and BAML provider with Claude, GPT-4o and Mistral fallback.
- Hero screenshot and README badges.

### Fixed

- BAML and Mastra paths made runnable, graph-aware rerank added, CI, Docker and docs fixed (2026-06-28).
- BAML provider runnable from the built bundle and with a single key (2026-06-29).
