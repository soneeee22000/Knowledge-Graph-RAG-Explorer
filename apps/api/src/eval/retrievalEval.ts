import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Citation } from '@kg/shared';
import {
  EXPANSION_DEPTH,
  GRAPH_BOOST,
  expandFromCitations,
  rerankByGraph,
} from '../agents/graphRetrieval.js';
import { retrieveContext } from '../agents/tools.js';
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

export interface ItemReport {
  id: string;
  kind: ItemKind;
  question: string;
  vectorOnly: ModeResult;
  graphExpand: ModeResult & { boostedChunks: number };
}

export interface ModeSummary {
  all: Summary;
  byKind: Partial<Record<ItemKind, Summary>>;
}

/** The full, deterministic evaluation report written to results.json. */
export interface EvalReport {
  evalSet: { name: string; author: string; items: number };
  corpus: { name: string; documents: number; chunks: number; entities: number; relations: number };
  config: { provider: string; topK: number; graphBoost: number; expansionDepth: number };
  summary: { vectorOnly: ModeSummary; graphExpand: ModeSummary };
  comparison: { improved: number; worsened: number; unchanged: number; orderChanged: number };
  items: ItemReport[];
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

async function scoreItem(
  stores: AppStores,
  item: EvalItem,
  topK: number,
  lookup: ChunkLookup,
): Promise<ItemReport> {
  const citations = await retrieveContext(stores, item.question, topK);
  const expanded = expandFromCitations(stores.graphStore, citations);
  const rerank = rerankByGraph(citations, expanded.entities);
  return {
    id: item.id,
    kind: item.kind,
    question: item.question,
    vectorOnly: scoreMode(citations, item, lookup),
    graphExpand: { ...scoreMode(rerank.ranked, item, lookup), boostedChunks: rerank.boostedCount },
  };
}

function summarizeMode(items: ItemReport[], pick: (i: ItemReport) => ModeResult): ModeSummary {
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

function compareModes(items: ItemReport[], topK: number): EvalReport['comparison'] {
  const delta = (i: ItemReport): number =>
    rankValue(i.vectorOnly.rank, topK) - rankValue(i.graphExpand.rank, topK);
  const orderChanged = items.filter(
    (i) => i.vectorOnly.retrieved.join('|') !== i.graphExpand.retrieved.join('|'),
  ).length;
  return {
    improved: items.filter((i) => delta(i) > 0).length,
    worsened: items.filter((i) => delta(i) < 0).length,
    unchanged: items.filter((i) => delta(i) === 0).length,
    orderChanged,
  };
}

function buildReport(
  stores: AppStores,
  corpus: Corpus,
  evalSet: EvalSet,
  items: ItemReport[],
): EvalReport {
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
    },
    summary: {
      vectorOnly: summarizeMode(items, (i) => i.vectorOnly),
      graphExpand: summarizeMode(items, (i) => i.graphExpand),
    },
    comparison: compareModes(items, evalSet.topK),
    items,
  };
}

/**
 * Ingest the corpus with the keyless mock provider, then score every question
 * twice on the same retrieved candidates: in vector order, and after the
 * pipeline's graph-expand + rerank step. Uses a throwaway data directory.
 */
export async function runRetrievalEval(corpus: Corpus, evalSet: EvalSet): Promise<EvalReport> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kg-eval-'));
  try {
    const stores = new AppStores(dataDir, new MockLlmProvider());
    await ingestCorpus(stores, corpus);
    const lookup = buildChunkLookup(stores);
    const items: ItemReport[] = [];
    for (const item of evalSet.items) {
      items.push(await scoreItem(stores, item, evalSet.topK, lookup));
    }
    return buildReport(stores, corpus, evalSet, items);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}
