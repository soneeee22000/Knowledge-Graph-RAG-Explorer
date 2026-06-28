import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLlmProvider } from '../llm/index.js';
import type { LlmProvider } from '../llm/provider.js';
import { Corpus } from './corpus.js';
import { GraphStore } from './graphStore.js';
import { VectorStore } from './vectorStore.js';

/**
 * The shared application state: one provider + three stores, wired together.
 * Routes and the RAG agent all operate on a single `AppStores` instance.
 */
export class AppStores {
  readonly provider: LlmProvider;
  readonly vectorStore: VectorStore;
  readonly graphStore: GraphStore;
  readonly corpus: Corpus;

  constructor(
    private readonly dataDir: string,
    provider: LlmProvider = createLlmProvider(),
  ) {
    this.provider = provider;
    this.vectorStore = new VectorStore(dataDir);
    this.graphStore = new GraphStore(dataDir);
    this.corpus = new Corpus(dataDir, this.vectorStore, this.graphStore, provider);
  }

  /** Load any persisted artifacts from disk. Empty corpus is fine. */
  async load(): Promise<void> {
    await Promise.all([this.vectorStore.load(), this.graphStore.load(), this.corpus.load()]);
  }

  /** Clear all in-memory stores and delete persisted JSON artifacts. */
  async clearAll(): Promise<void> {
    this.vectorStore.clear();
    this.graphStore.clear();
    this.corpus.clear();
    await Promise.all(
      ['vectors.json', 'graph.json', 'documents.json'].map((f) =>
        rm(join(this.dataDir, f), { force: true }),
      ),
    );
  }
}
