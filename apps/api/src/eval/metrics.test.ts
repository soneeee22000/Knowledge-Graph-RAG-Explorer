import { describe, expect, it } from 'vitest';
import type { Evidence } from './dataset.js';
import {
  evidenceRecall,
  firstRelevantRank,
  matchesEvidence,
  reciprocalRank,
  summarize,
  type ItemScore,
  type RankedChunk,
} from './metrics.js';

const chunks: RankedChunk[] = [
  { documentTitle: 'A', chunkIndex: 0, text: 'Nothing useful here.' },
  { documentTitle: 'B', chunkIndex: 0, text: 'The Series 40 is built\nby   Corvel Works.' },
  { documentTitle: 'C', chunkIndex: 1, text: 'Brennock Depot maintains trains.' },
];

const corvel: Evidence = { document: 'B', contains: 'built by Corvel Works' };
const depot: Evidence = { document: 'C', contains: 'Brennock Depot' };
const missing: Evidence = { document: 'D', contains: 'absent' };

describe('matchesEvidence', () => {
  it('matches on document title and whitespace-normalised phrase', () => {
    expect(matchesEvidence(chunks[1]!, corvel)).toBe(true);
  });

  it('rejects a phrase found in a different document', () => {
    expect(matchesEvidence(chunks[1]!, { document: 'A', contains: 'Corvel Works' })).toBe(false);
  });
});

describe('firstRelevantRank', () => {
  it('returns the 1-based rank of the first chunk matching any evidence', () => {
    expect(firstRelevantRank(chunks, [depot, corvel])).toBe(2);
  });

  it('returns null when nothing matches', () => {
    expect(firstRelevantRank(chunks, [missing])).toBeNull();
  });
});

describe('reciprocalRank', () => {
  it('is 1/rank, or 0 when nothing was found', () => {
    expect(reciprocalRank(4)).toBe(0.25);
    expect(reciprocalRank(null)).toBe(0);
  });
});

describe('evidenceRecall', () => {
  it('counts evidence items covered by at least one ranked chunk', () => {
    expect(evidenceRecall(chunks, [corvel, depot, missing])).toEqual({ found: 2, total: 3 });
  });
});

describe('summarize', () => {
  const scores: ItemScore[] = [
    { rank: 1, evidenceFound: 2, evidenceTotal: 2 },
    { rank: 3, evidenceFound: 1, evidenceTotal: 2 },
    { rank: null, evidenceFound: 0, evidenceTotal: 1 },
  ];

  it('aggregates hit@1, hit@3, MRR and full-evidence recall', () => {
    expect(summarize(scores)).toEqual({
      items: 3,
      hitAt1: 1,
      hitAt3: 2,
      mrr: 0.4444,
      allEvidenceRetrieved: 1,
      evidenceFound: 3,
      evidenceTotal: 5,
    });
  });

  it('returns zeros for an empty list', () => {
    expect(summarize([]).mrr).toBe(0);
  });
});
