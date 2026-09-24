# Retrieval evaluation: graph-expand vs vector-only

This is a small, authored check of whether the pipeline's graph step changes what reaches the answer. It is not a benchmark.

## What is compared

Both modes use the same ingestion pipeline, the same keyless mock provider and the same `topK` (6, the app default).

| Mode             | What it does                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **vector-only**  | `retrieveContext`: cosine search over the mock embeddings, top 6 chunks in score order.                                                                                                                                                                  |
| **graph-expand** | The same 6 chunks, then `expandFromCitations` (seed entities from the retrieved chunks, one hop along graph edges) and `rerankByGraph` (+0.15 to any chunk that contributed an expanded entity). These are the functions `runRagQuery` calls in the app. |

The graph step can only **reorder** the six retrieved chunks; it never adds one. A test (`retrievalEval.test.ts`) asserts that both modes return the same candidate set.

## Data

- **Corpus:** [`apps/api/eval/corpus.json`](../apps/api/eval/corpus.json). Ten short documents about an invented regional rail network. Every name and number is fictional. After ingestion: 12 chunks, 51 entities, 68 relations.
- **Questions:** [`apps/api/eval/questions.json`](../apps/api/eval/questions.json). 20 questions written by the repo author, committed before any result was generated (see the git history). Ten are single-hop. Ten are multi-hop: the answer needs a second chunk reached through an entity the question does not name, for example "Which company builds the trains that run on the Amber Line?" needs the Amber Line chunk (Series 40) and the rolling-stock chunk (built by Corvel Works).
- **Labels:** each item lists evidence as `{document, contains}`. A retrieved chunk counts as relevant when it comes from that document and contains that phrase. A test checks that every phrase exists in its document.

## Metrics

- **Hit@1, Hit@3:** the first relevant chunk is at rank 1, or within the top 3.
- **MRR:** mean of 1 / rank of the first relevant chunk (0 if none).
- **All evidence in top-k:** every evidence item of the question is covered by at least one of the six retrieved chunks. This matters for multi-hop items.

## Results

From `npm run eval` (committed as [`apps/api/eval/results.json`](../apps/api/eval/results.json), re-generated and diffed by CI):

| Mode         | Kind       | Items | Hit@1 | Hit@3 | MRR   | All evidence in top-k |
| ------------ | ---------- | ----- | ----- | ----- | ----- | --------------------- |
| vector-only  | all        | 20    | 16/20 | 20/20 | 0.900 | 18/20                 |
| vector-only  | single-hop | 10    | 8/10  | 10/10 | 0.900 | 10/10                 |
| vector-only  | multi-hop  | 10    | 8/10  | 10/10 | 0.900 | 8/10                  |
| graph-expand | all        | 20    | 16/20 | 20/20 | 0.900 | 18/20                 |
| graph-expand | single-hop | 10    | 8/10  | 10/10 | 0.900 | 10/10                 |
| graph-expand | multi-hop  | 10    | 8/10  | 10/10 | 0.900 | 8/10                  |

**The graph step changed nothing.** The first relevant rank improved on 0 questions, worsened on 0, and the top-6 order changed on 0 of 20.

## Why it changed nothing

On every one of the 20 questions, all six retrieved chunks contributed at least one seed entity (the mock extractor takes capitalised phrases, which almost every chunk contains). So every chunk gets the same +0.15 and the sort order is the vector order. Per-item `boostedChunks` in `results.json` is 6 on every item.

This is a property of the current design, not of this question set: whenever every retrieved chunk has an entity, a uniform boost is a no-op. The two multi-hop misses (`m01`, `m03`) are cases where the second evidence chunk was not in the top 6 at all, which a reorder-only step cannot fix.

What the graph step does do in the app: it gives the UI the sub-graph to highlight, and it appends the expanded entity labels to the synthesis context. Neither is measured here.

## How to read this

- **Small and authored.** 20 questions, 12 chunks, one author who also wrote the corpus. With `topK = 6` over 12 chunks, retrieval sees half the corpus, which helps explain why Hit@3 is 20/20 for both modes. These numbers say nothing about retrieval quality on real documents.
- **Mock embeddings.** The embedder hashes tokens into 256 buckets. It rewards lexical overlap. A real embedding model would give different vector-only numbers.
- **Mock extraction.** Entities are capitalised phrases and relations are same-sentence co-occurrence. A BAML/LLM extractor would build a different graph.
- **Retrieval only.** Answers are not scored.

## Possible next steps

These are not built:

1. Let expansion **add** candidates: fetch chunks that are the provenance of entities reached by the hop, outside the vector top-k, then rerank the union. That is the change that could fix `m01` and `m03`.
2. Boost only chunks reached **through an edge**, not the seeds' own chunks, so the boost is not uniform.
3. A harder set: more documents than `topK` can cover, and questions whose bridge entity shares no words with the question.

## Reproduce

```bash
npm install
npm run eval         # prints the table and rewrites apps/api/eval/results.json
npm run eval:check   # fails if a fresh run differs from the committed file (CI runs this)
```
