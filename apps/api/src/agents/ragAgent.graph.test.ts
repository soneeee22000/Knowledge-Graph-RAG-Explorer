import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QueryEvent } from '@kg/shared';
import { MockLlmProvider } from '../llm/mock.js';
import { AppStores } from '../services/stores.js';
import { runRagQuery } from './ragAgent.js';

const DOCUMENTS: Array<{ title: string; content: string }> = [
  {
    title: 'Amber Line',
    content: 'The Amber Line runs every ten minutes. The Amber Line uses Zephyr trains.',
  },
  { title: 'Fleet', content: 'Zephyr units are assembled by Corvel Works in Brennock.' },
  { title: 'Timetable', content: 'Evening services run every twenty minutes.' },
  { title: 'Fares', content: 'Trains on the network accept Tallypass cards.' },
];

const QUESTION = 'Which trains run on the Amber Line?';
const TOP_K = 2;

async function collect(stores: AppStores, useGraphExpansion: boolean): Promise<QueryEvent[]> {
  const events: QueryEvent[] = [];
  await runRagQuery(stores, { question: QUESTION, topK: TOP_K, useGraphExpansion }, (e) => {
    events.push(e);
  });
  return events;
}

function answerTitles(events: QueryEvent[]): string[] {
  const answer = events.find((e) => e.type === 'answer');
  return answer?.type === 'answer' ? answer.answer.citations.map((c) => c.documentTitle) : [];
}

function firstRetrievedTitles(events: QueryEvent[]): string[] {
  const retrieved = events.find((e) => e.type === 'retrieved');
  return retrieved?.type === 'retrieved' ? retrieved.citations.map((c) => c.documentTitle) : [];
}

describe('runRagQuery graph expansion', () => {
  let dataDir: string;
  let stores: AppStores;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kg-rag-graph-'));
    stores = new AppStores(dataDir, new MockLlmProvider());
    for (const doc of DOCUMENTS) {
      await stores.corpus.ingest({ ...doc, source: 'test' }, () => undefined);
    }
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('brings in a chunk the vector top-k missed, reached through a shared entity', async () => {
    const events = await collect(stores, true);
    expect(firstRetrievedTitles(events)).not.toContain('Fleet');
    expect(answerTitles(events)).toContain('Fleet');
    expect(answerTitles(events)).toHaveLength(TOP_K);
  });

  it('reports the added chunk in the rerank step', async () => {
    const events = await collect(stores, true);
    const rerank = events.filter((e) => e.type === 'thought' && e.step.phase === 'rerank').at(-1);
    expect(rerank?.type === 'thought' ? rerank.step.detail : '').toMatch(/added 1 chunk/i);
  });

  it('keeps the vector top-k when graph expansion is off', async () => {
    const events = await collect(stores, false);
    expect(answerTitles(events)).not.toContain('Fleet');
    expect(answerTitles(events)).toEqual(firstRetrievedTitles(events));
  });
});
