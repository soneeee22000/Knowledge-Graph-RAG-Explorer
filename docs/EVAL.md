# Retrieval evaluation: does the graph step change what reaches the answer?

This is a small, authored check, not a benchmark. It has been run twice: once on the original graph step (v1), which turned out to do nothing, and again after that step was rebuilt (v2) so it can add candidates. Both results are below, and CI reproduces both on every push.

## The short version

| Question set                      | Mode                 | Hit@1 | Hit@3 | MRR   | All evidence in top-6 |
| --------------------------------- | -------------------- | ----- | ----- | ----- | --------------------- |
| Original 20 (10 single, 10 multi) | vector-only          | 16/20 | 20/20 | 0.900 | 18/20                 |
|                                   | graph-expand (v1)    | 16/20 | 20/20 | 0.900 | 18/20                 |
|                                   | graph-augmented (v2) | 15/20 | 20/20 | 0.875 | 18/20                 |
| Post-fix 8 (multi-hop, see below) | vector-only          | 6/8   | 8/8   | 0.875 | 6/8                   |
|                                   | graph-expand (v1)    | 6/8   | 8/8   | 0.875 | 6/8                   |
|                                   | graph-augmented (v2) | 6/8   | 8/8   | 0.875 | 6/8                   |

- **v1 was a no-op.** It changed the top-6 order on 0 of 20 questions.
- **v2 changes retrieval, but it does not improve it on this data.** It reordered the top 6 on 17 of 20 original questions and 5 of 8 post-fix questions, and changed which chunks were in it on 12 and 2 of those (`membershipChanged` in the results files). It brought no missing evidence chunk into the top 6 on either set. On the original set it cost one Hit@1 (`m03`: the first relevant chunk moved from rank 1 to rank 2), so MRR dropped from 0.900 to 0.875.
- **Neither set shows a gain, and the likely cause is the mock graph, not the questions.** The mock extractor's graph is so densely connected that v2's graph support comes out almost the same for every chunk (explained below).

## What is compared

All three modes use the same ingestion, the same keyless mock provider, the same `topK` (6, the app default), and one vector ranking per question.

| Mode                     | What it does                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **vector-only**          | Cosine search over the mock embeddings: the top 6 chunks in score order.                                                                                                                                                                                                                                                                        |
| **graph-expand (v1)**    | The original step, kept so its result is still reproduced: seed entities from the 6 retrieved chunks, one hop out, then +0.15 (`GRAPH_BOOST`) to any retrieved chunk that contributed an expanded entity. It can only **reorder** the same 6 chunks. A test (`retrievalEval.test.ts`) asserts that.                                             |
| **graph-augmented (v2)** | The step `runRagQuery` now runs (`augmentWithGraph` in `apps/api/src/agents/graphRetrieval.ts`). Expansion **adds** chunks outside the vector top 6, the union is reranked, and the result is cut back to 6. The scoring rule is below. `ragAgent.graph.test.ts` shows a chunk that vector search missed reaching the answer through this step. |

### The v2 scoring rule

The constants are named in `graphRetrieval.ts` and recorded in every results file.

1. **Seeds.** The entities mentioned in the top `SEED_CHUNK_COUNT = 3` vector chunks.
2. **Reach.** Each seed entity is reached at hop 0. Each of its direct neighbours in the graph is reached at hop 1.
3. **Support.** A reached entity gives every chunk that mentions it (except the seed chunk itself) this support:
   `seed chunk's vector score x HOP_DECAY^hop x 1 / (number of chunks mentioning the entity)`, with `HOP_DECAY = 0.5`.
   A chunk keeps only its single strongest support (a max, not a sum), so a hub entity cannot pile up.
4. **Candidates.** The vector top 6, plus every chunk with support above 0.
5. **Rank.** Candidates are sorted by `vector score + GRAPH_SUPPORT_WEIGHT x support` (`GRAPH_SUPPORT_WEIGHT = 1`). Ties go to the better vector rank, so the order is deterministic. The list is then cut to 6.

The three constants were set once, before the first v2 run, and were not tuned against either question set.

## Data

- **Corpus:** [`apps/api/eval/corpus.json`](../apps/api/eval/corpus.json). Ten short documents about an invented regional rail network. Every name and number is fictional. After ingestion: 12 chunks, 51 entities, 68 relations. The public read-only demo serves this same corpus.
- **Original questions:** [`questions.json`](../apps/api/eval/questions.json). 20 questions written by the repo author before any result was generated. Ten are single-hop. Ten are multi-hop: the answer needs a second chunk reached through an entity the question does not name. For example, "Which company builds the trains that run on the Amber Line?" needs the Amber Line chunk (Series 40) and the rolling-stock chunk (built by Corvel Works).
- **Post-fix questions:** [`questions-postfix.json`](../apps/api/eval/questions-postfix.json). Eight more multi-hop questions, written **after** v2 was implemented and after its results on the original 20 were known. They are a separate stratum with their own results file and are never merged into the original numbers. They were committed before any result on them was generated (see the git history). They were added to check whether the original set was simply unable to show a difference. v2 made no difference on them either, which points at the graph rather than the questions (see below).
- **Labels:** each item lists evidence as `{document, contains}`. A retrieved chunk counts as relevant when it comes from that document and contains that phrase. Tests check that every phrase exists in its document.

## Metrics

- **Hit@1, Hit@3:** the first relevant chunk is at rank 1, or within the top 3.
- **MRR:** mean of 1 / rank of the first relevant chunk (0 if none).
- **All evidence in top-6:** every evidence item of the question is covered by one of the six chunks returned. This is the one that matters for multi-hop questions.

## Results in detail

From `npm run eval`, committed as [`results.json`](../apps/api/eval/results.json) and [`results-postfix.json`](../apps/api/eval/results-postfix.json). CI re-runs both and fails on any difference.

Original 20 questions:

| Mode                 | Kind       | Items | Hit@1 | Hit@3 | MRR   | All evidence in top-6 |
| -------------------- | ---------- | ----- | ----- | ----- | ----- | --------------------- |
| vector-only          | single-hop | 10    | 8/10  | 10/10 | 0.900 | 10/10                 |
| vector-only          | multi-hop  | 10    | 8/10  | 10/10 | 0.900 | 8/10                  |
| graph-expand (v1)    | single-hop | 10    | 8/10  | 10/10 | 0.900 | 10/10                 |
| graph-expand (v1)    | multi-hop  | 10    | 8/10  | 10/10 | 0.900 | 8/10                  |
| graph-augmented (v2) | single-hop | 10    | 8/10  | 10/10 | 0.900 | 10/10                 |
| graph-augmented (v2) | multi-hop  | 10    | 7/10  | 10/10 | 0.850 | 8/10                  |

Compared with vector-only, v2's first-relevant rank improved on 0 questions, worsened on 1 (`m03`) and was unchanged on 19. On every question, v2 added all 6 chunks outside the vector top 6 to the candidate list. On 12 questions, 13 of those added chunks made the final top 6. None of them was a missing evidence chunk. The two multi-hop misses, `m01` and `m03`, are the same under all three modes.

Post-fix 8 questions: all three modes score the same on every metric. v2 reordered the top 6 on 5 of 8 questions and promoted 3 added chunks into it, on 2 questions. The two misses, `p03` and `p04`, are the same under all three modes.

## Why v1 changed nothing

On all 20 questions, every one of the six retrieved chunks contributed at least one seed entity (the mock extractor takes capitalised phrases, and almost every chunk has some). So every chunk got the same +0.15, and the order stayed the vector order. A uniform boost is a no-op, whatever the question set.

## Why v2 does not help here

A one-off dump of `augmentWithGraph`'s candidate list for `m01`, `p03` and `p04` (printed while debugging, not saved in the repo; the results files record only the added and promoted chunks) shows the same pattern. The graph support of most chunks falls between 0.15 and 0.20, close to half the top seed chunk's vector score. It is nearly uniform again, so the final order stays close to the vector order.

Two properties of the mock graph cause this:

1. **Co-occurrence edges connect nearly everything.** Relations are "these two capitalised phrases share a sentence". Almost every chunk has an entity that appears only in that chunk (specificity 1) and is one hop from some seed entity. So almost every chunk gets close to the maximum hop-1 support. Many of those entities are extraction noise such as "No", "Board", "Each" or "Thirty".
2. **The real bridge entity is lost at extraction.** "Series 40" and "Series 22" are extracted as a single entity, "Series", because the extractor drops the number. That entity is mentioned in 6 of the 12 chunks. Its hop-0 support is divided by 6, so the rolling-stock chunk gets no more support than unrelated chunks.

With `topK = 6` over 12 chunks, vector search also already returns half the corpus. So v2 always adds the other half, and nothing distinguishes them.

## How to read this

- **Small and authored.** 28 questions over 12 chunks, all by the corpus author. The post-fix 8 were written knowing how v2 works. These numbers say nothing about retrieval on real documents.
- **Mock embeddings.** The embedder hashes tokens into 256 buckets and rewards lexical overlap. A real embedding model would give different vector-only numbers.
- **Mock extraction.** It limits what any graph step can do here (see above). A BAML/LLM extractor would build a different, sparser and typed graph. The BAML path has not been evaluated.
- **Retrieval only.** Answers are not scored.

## What would test v2 properly

These are not built:

1. A sparser graph: typed relations from an LLM extractor, or at least dropping one-word noise entities, so that hop-1 support is not near-uniform.
2. An extractor that keeps "Series 40" and "Series 22" apart, so the bridge entity is specific.
3. A larger corpus than `topK` can mostly cover, so the "added" set is a real choice rather than "everything else".

## Reproduce

```bash
npm install
npm run eval         # prints both tables and rewrites results.json and results-postfix.json
npm run eval:check   # fails if a fresh run differs from either committed file (CI runs this)
```
