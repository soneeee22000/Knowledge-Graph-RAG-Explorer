import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IngestEvent, QueryEvent } from '@kg/shared';
import { MockLlmProvider } from '../llm/mock.js';
import { AppStores } from '../services/stores.js';
import { runRagQuery } from './ragAgent.js';

const DOC = `Mastra AI builds an agent framework written in TypeScript.
The Mastra framework integrates with BAML for structured data extraction.
Graphology powers the knowledge graph that links entities extracted from documents.
The RAG Explorer retrieves chunks and expands the graph to ground its answers.`;

describe('runRagQuery integration', () => {
  let dataDir: string;
  let stores: AppStores;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kg-rag-'));
    stores = new AppStores(dataDir, new MockLlmProvider());
    await stores.load();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('ingests a doc then answers with citations and a done event', async () => {
    const ingestEvents: IngestEvent[] = [];
    await stores.corpus.ingest(
      { title: 'Mastra Overview', source: 'test', content: DOC },
      (e) => {
        ingestEvents.push(e);
      },
    );
    expect(ingestEvents.some((e) => e.type === 'complete')).toBe(true);
    expect(stores.vectorStore.size).toBeGreaterThan(0);
    expect(stores.graphStore.entityCount).toBeGreaterThan(0);

    const events: QueryEvent[] = [];
    await runRagQuery(
      stores,
      { question: 'What framework does Mastra build?', topK: 4, useGraphExpansion: true },
      (e) => {
        events.push(e);
      },
    );

    // Terminal event present.
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // Retrieved citations are non-empty.
    const retrieved = events.find((e) => e.type === 'retrieved');
    expect(retrieved).toBeDefined();
    if (retrieved && retrieved.type === 'retrieved') {
      expect(retrieved.citations.length).toBeGreaterThan(0);
    }

    // Final answer is non-empty and carries citations.
    const answerEvent = events.find((e) => e.type === 'answer');
    expect(answerEvent).toBeDefined();
    if (answerEvent && answerEvent.type === 'answer') {
      expect(answerEvent.answer.text.length).toBeGreaterThan(0);
      expect(answerEvent.answer.citations.length).toBeGreaterThan(0);
    }

    // Tokens streamed.
    expect(events.some((e) => e.type === 'token')).toBe(true);

    // Graph expansion emitted a graph event.
    expect(events.some((e) => e.type === 'graph')).toBe(true);
  });
});
