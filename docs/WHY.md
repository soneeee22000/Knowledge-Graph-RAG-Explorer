# Why this exists

**A RAG answer is hard to trust when you cannot see where it came from.** A typical retrieval-augmented system embeds the question, fetches some chunks and hands them to a model. The user gets fluent text back, but not which passages were used, why those and not others, or what the system did between the question and the answer.

**Adding a knowledge graph makes that harder to check, not easier.** GraphRAG designs add entity extraction, graph traversal and reranking on top of vector search. Every step is another place where the output can drift from the source. It is also another step that may quietly do nothing. This repo's own evaluation found exactly that: its first graph rerank never changed the order of retrieved chunks on the authored question set. The rebuilt step does change what is retrieved, but on the same data it has not improved the metrics ([EVAL.md](EVAL.md)).

**This project makes each step visible and testable.** Every stage of the pipeline is streamed to the browser as a typed event, so a reviewer watches plan, retrieve, graph-expand, rerank and synthesize happen, and sees the cited chunks and the traversed sub-graph on a canvas. The same stages run with a deterministic, keyless mock provider, so the behaviour can be pinned down by tests and by a committed evaluation. It is aimed at engineers building or reviewing RAG systems who want to inspect the pipeline, not just its final answer.

## Layer by layer

| Layer          | Problem                                                                           | How the project answers it                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contracts**  | Front end and back end drift apart on event and data shapes.                      | One `@kg/shared` package of Zod schemas, used by both apps and validated at the boundaries.                                                 |
| **Ingestion**  | You cannot see how a document turned into chunks, vectors and entities.           | Chunk → embed → extract → link → persist, with each phase streamed as an `IngestEvent`.                                                     |
| **Retrieval**  | Vector search and graph expansion are mixed, so neither can be judged on its own. | Vector retrieval and graph-augmented retrieval (one-hop expansion that adds candidates, then a rerank) are separate, unit-tested functions. |
| **Reasoning**  | The steps between the question and the answer are hidden.                         | Each step is streamed as a `ThoughtStep` and drawn as a timeline. Traversed entities are highlighted on a VueFlow canvas.                   |
| **Evaluation** | "Graph helps" gets asserted rather than measured.                                 | Authored question sets compare vector-only with the original and the rebuilt graph step. The results are committed and diffed by CI.        |

## What this is not

- **Not a product.** It is a portfolio project that runs locally. No hosted demo exists yet ([DEPLOY.md](DEPLOY.md) has the prepared steps).
- **Not evidence that GraphRAG beats vector search.** On its own evaluation, the graph step made no difference.
- **Not real embeddings by default.** The default mock provider uses hashed-token embeddings and capitalised-phrase extraction. The BAML path swaps in LLM extraction and answers, but it keeps the local embedder.
- **Not multi-user.** There is one shared in-memory corpus, persisted to JSON files. There is no auth.
