import type { Evidence } from './dataset.js';

/** Decimal places kept for averaged metrics, so committed results diff cleanly. */
const METRIC_DECIMALS = 4;

/** A retrieved chunk as seen by the scorer. */
export interface RankedChunk {
  documentTitle: string;
  chunkIndex: number;
  text: string;
}

/** Per-item score in one retrieval mode. */
export interface ItemScore {
  /** 1-based rank of the first chunk matching any evidence item, or null. */
  rank: number | null;
  evidenceFound: number;
  evidenceTotal: number;
}

/** Aggregate over a list of item scores. */
export interface Summary {
  items: number;
  hitAt1: number;
  hitAt3: number;
  mrr: number;
  /** Items where every evidence item appears somewhere in the retrieved list. */
  allEvidenceRetrieved: number;
  evidenceFound: number;
  evidenceTotal: number;
}

const HIT_AT_3 = 3;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function round(value: number): number {
  const factor = 10 ** METRIC_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** True when the chunk belongs to the evidence document and contains its phrase. */
export function matchesEvidence(chunk: RankedChunk, evidence: Evidence): boolean {
  return (
    chunk.documentTitle === evidence.document && normalise(chunk.text).includes(evidence.contains)
  );
}

/** 1-based rank of the first chunk supporting any evidence item, or null. */
export function firstRelevantRank(ranked: RankedChunk[], evidence: Evidence[]): number | null {
  const index = ranked.findIndex((chunk) => evidence.some((e) => matchesEvidence(chunk, e)));
  return index === -1 ? null : index + 1;
}

/** Reciprocal rank: 1/rank, or 0 when no relevant chunk was retrieved. */
export function reciprocalRank(rank: number | null): number {
  return rank === null ? 0 : 1 / rank;
}

/** How many evidence items are supported by at least one retrieved chunk. */
export function evidenceRecall(
  ranked: RankedChunk[],
  evidence: Evidence[],
): { found: number; total: number } {
  const found = evidence.filter((e) => ranked.some((chunk) => matchesEvidence(chunk, e))).length;
  return { found, total: evidence.length };
}

/** Aggregate hit@1, hit@3, MRR and evidence recall over item scores. */
export function summarize(scores: ItemScore[]): Summary {
  const hits = (k: number): number => scores.filter((s) => s.rank !== null && s.rank <= k).length;
  const rrSum = scores.reduce((sum, s) => sum + reciprocalRank(s.rank), 0);
  return {
    items: scores.length,
    hitAt1: hits(1),
    hitAt3: hits(HIT_AT_3),
    mrr: scores.length === 0 ? 0 : round(rrSum / scores.length),
    allEvidenceRetrieved: scores.filter((s) => s.evidenceFound === s.evidenceTotal).length,
    evidenceFound: scores.reduce((sum, s) => sum + s.evidenceFound, 0),
    evidenceTotal: scores.reduce((sum, s) => sum + s.evidenceTotal, 0),
  };
}
