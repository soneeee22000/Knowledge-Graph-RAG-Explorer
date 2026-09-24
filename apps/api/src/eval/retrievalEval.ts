import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Citation } from '@kg/shared';
import {
  EXPANSION_DEPTH,
  GRAPH_BOOST,
  GRAPH_SUPPORT_WEIGHT,
  HOP_DECAY,
  SEED_CHUNK_COUNT,
  expandFromCitations,
  rerankByGraph,
} from '../agents/graphRetrieval.js';
import { retrieveWithGraph, type GraphRetrievalResult } from '../agents/tools.js';
import { MockLlmProvider } from '../llm/mock.js';
import { AppStores } from '../services/stores.js';
import type { Corpus, EvalItem, EvalSet, ItemKind } from './dataset.js';
import {
  evidenceRecall,
  firstRelevantRank,
  summarize,
  type ItemScore,
  type RankedChunk,
  type Summary,
} from './metrics.js';

const ITEM_KINDS: readonly ItemKind[] = ['single-hop', 'multi-hop'];

/** One item scored in one retrieval mode. */
export interface ModeResult extends ItemScore {
  /** Retrieved chunks in rank order, as "<document title>#<chunk index>". */
  retrieved: string[];
}

/** The graph-augmented mode also records which chunks the graph added. */
export interface AugmentedModeResult extends ModeResult {
  /** Chunks outside the vector top-k that expansion added to the candidate union. */
  addedChunks: string[];
  /** Added chunks that made the final top-k. */
  promotedChunks: string[];
}

/**
 * `graphExpand` is the original graph step (v1): expand, then reorder the
 * vector top-k only. `graphAugmented` is the current pipeline step (v2):
 * expansion adds candidates, the union is reranked and cut to k.
 */
export interface ItemReport {
  id: string;
  kind: ItemKind;
  question: string;
  vectorOnly: ModeResult;
  graphExpand: ModeResult & { boostedChunks: number };
  graphAugmented?: AugmentedModeResult;
}

export interface ModeSummary {
  all: Summary;
  byKind: Partial<Record<ItemKind, Summary>>;
}

export interface ModeComparison {
  improved: number;
  worsened: number;
  unchanged: number;
  /** Questions whose top-k list differs from vector-only in order or membership. */
  orderChanged: number;
  /** Questions whose top-k chunk set differs from vector-only (a chunk came in or went out). */
  membershipChanged?: number;
}

/**
 * Evaluation report written to results.json. The graph-augmented fields are
 * optional in this shape so v1-only reports still type-check;
 * `runRetrievalEval` always fills them (see `FullEvalReport`).
 */
export interface EvalReport {
  evalSet: { name: string; author: string; items: number };
  corpus: { name: string; documents: number; chunks: number; entities: number; relations: number };
  config: {
    provider: string;
    topK: number;
    graphBoost: number;
    expansionDepth: number;
    seedChunkCount?: number;
    hopDecay?: number;
    graphSupportWeight?: number;
  };
  summary: { vectorOnly: ModeSummary; graphExpand: ModeSummary; graphAugmented?: ModeSummary };
  /** v1 graph-expand vs vector-only. */
  comparison: ModeComparison;
  /** v2 graph-augmented vs vector-only. */
  comparisonAugmented?: ModeComparison;
  items: ItemReport[];
}

type FullItemReport = Required<ItemReport>;

/** The report `runRetrievalEval` produces: every mode present. */
export interface FullEvalReport extends EvalReport {
  config: Required<EvalReport['config']>;
  summary: Required<EvalReport['summary']>;
  comparison: Required<ModeComparison>;
  comparisonAugmented: Required<ModeComparison>;
  items: FullItemReport[];
}

type ChunkLookup = Map<string, RankedChunk>;

async function ingestCorpus(stores: AppStores, corpus: Corpus): Promise<void> {
  for (const document of corpus.documents) {
    await stores.corpus.ingest(
      { title: document.title, source: 'eval', content: document.content },
      () => undefined,
    );
  }
}

function buildChunkLookup(stores: AppStores): ChunkLookup {
  const titles = new Map(stores.corpus.listDocuments().map((d) => [d.id, d.title]));
  const lookup: ChunkLookup = new Map();
  for (const { chunk } of stores.vectorStore.all()) {
    const documentTitle = titles.get(chunk.documentId) ?? chunk.documentId;
    lookup.set(chunk.id, { documentTitle, chunkIndex: chunk.index, text: chunk.text });
  }
  return lookup;
}

function scoreMode(citations: Citation[], item: EvalItem, lookup: ChunkLookup): ModeResult {
  const ranked = citations
    .map((c) => lookup.get(c.chunkId))
    .filter((chunk): chunk is RankedChunk => chunk !== undefined);
  const recall = evidenceRecall(ranked, item.evidence);
  return {
    rank: firstRelevantRank(ranked, item.evidence),
    evidenceFound: recall.found,
    evidenceTotal: recall.total,
    retrieved: ranked.map((chunk) => `${chunk.documentTitle}#${chunk.chunkIndex}`),
  };
}

function scoreAugmented(
  retrieval: GraphRetrievalResult,
  item: EvalItem,
  lookup: ChunkLookup,
): AugmentedModeResult {
  const name = (chunkId: string): string => {
    const chunk = lookup.get(chunkId);
    return chunk ? `${chunk.documentTitle}#${chunk.chunkIndex}` : chunkId;
  };
  const { addedChunkIds, promotedChunkIds } = retrieval.augmentation;
  return {
    ...scoreMode(retrieval.citations, item, lookup),
    addedChunks: addedChunkIds.map(name),
    promotedChunks: promotedChunkIds.map(name),
  };
}

async function scoreItem(
  stores: AppStores,
  item: EvalItem,
  topK: number,
  lookup: ChunkLookup,
): Promise<FullItemReport> {
  const retrieval = await retrieveWithGraph(stores, item.question, topK);
  const citations = retrieval.vectorCitations;
  const expanded = expandFromCitations(stores.graphStore, citations);
  const rerank = rerankByGraph(citations, expanded.entities);
  return {
    id: item.id,
    kind: item.kind,
    question: item.question,
    vectorOnly: scoreMode(citations, item, lookup),
    graphExpand: { ...scoreMode(rerank.ranked, item, lookup), boostedChunks: rerank.boostedCount },
    graphAugmented: scoreAugmented(retrieval, item, lookup),
  };
}

function summarizeMode(
  items: FullItemReport[],
  pick: (i: FullItemReport) => ModeResult,
): ModeSummary {
  const byKind: Partial<Record<ItemKind, Summary>> = {};
  for (const kind of ITEM_KINDS) {
    const subset = items.filter((i) => i.kind === kind);
    if (subset.length > 0) byKind[kind] = summarize(subset.map(pick));
  }
  return { all: summarize(items.map(pick)), byKind };
}

function rankValue(rank: number | null, topK: number): number {
  return rank ?? topK + 1;
}

function compareModes(
  items: FullItemReport[],
  topK: number,
  pick: (i: FullItemReport) => ModeResult,
): Required<ModeComparison> {
  const delta = (i: FullItemReport): number =>
    rankValue(i.vectorOnly.rank, topK) - rankValue(pick(i).rank, topK);
  const orderChanged = items.filter(
    (i) => i.vectorOnly.retrieved.join('|') !== pick(i).retrieved.join('|'),
  ).length;
  const asSet = (retrieved: string[]): string => [...retrieved].sort().join('|');
  const membershipChanged = items.filter(
    (i) => asSet(i.vectorOnly.retrieved) !== asSet(pick(i).retrieved),
  ).length;
  return {
    improved: items.filter((i) => delta(i) > 0).length,
    worsened: items.filter((i) => delta(i) < 0).length,
    unchanged: items.filter((i) => delta(i) === 0).length,
    orderChanged,
    membershipChanged,
  };
}

function buildReport(
  stores: AppStores,
  corpus: Corpus,
  evalSet: EvalSet,
  items: FullItemReport[],
): FullEvalReport {
  return {
    evalSet: { name: evalSet.name, author: evalSet.author, items: items.length },
    corpus: {
      name: corpus.name,
      documents: stores.corpus.documentCount,
      chunks: stores.vectorStore.size,
      entities: stores.graphStore.entityCount,
      relations: stores.graphStore.relationCount,
    },
    config: {
      provider: stores.provider.name,
      topK: evalSet.topK,
      graphBoost: GRAPH_BOOST,
      expansionDepth: EXPANSION_DEPTH,
      seedChunkCount: SEED_CHUNK_COUNT,
      hopDecay: HOP_DECAY,
      graphSupportWeight: GRAPH_SUPPORT_WEIGHT,
    },
    summary: {
      vectorOnly: summarizeMode(items, (i) => i.vectorOnly),
      graphExpand: summarizeMode(items, (i) => i.graphExpand),
      graphAugmented: summarizeMode(items, (i) => i.graphAugmented),
    },
    comparison: compareModes(items, evalSet.topK, (i) => i.graphExpand),
    comparisonAugmented: compareModes(items, evalSet.topK, (i) => i.graphAugmented),
    items,
  };
}

/**
 * Ingest the corpus with the keyless mock provider, then score every question
 * in three modes built from one vector ranking: vector-only, the original v1
 * graph step (reorder the top-k), and the current v2 graph step (expansion
 * adds candidates, rerank the union, cut to k). Uses a throwaway data directory.
 */
export async function runRetrievalEval(corpus: Corpus, evalSet: EvalSet): Promise<FullEvalReport> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kg-eval-'));
  try {
    const stores = new AppStores(dataDir, new MockLlmProvider());
    await ingestCorpus(stores, corpus);
    const lookup = buildChunkLookup(stores);
    const items: FullItemReport[] = [];
    for (const item of evalSet.items) {
      items.push(await scoreItem(stores, item, evalSet.topK, lookup));
    }
    return buildReport(stores, corpus, evalSet, items);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}
