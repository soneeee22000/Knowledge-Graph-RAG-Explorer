import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Chunk, Document, IngestEvent, IngestRequest } from '@kg/shared';
import type { LlmProvider } from '../llm/provider.js';
import { chunkText } from './chunker.js';
import { GraphStore } from './graphStore.js';
import { VectorStore } from './vectorStore.js';

/** Async callback the corpus calls with progress/terminal ingest events. */
export type IngestEmit = (event: IngestEvent) => void | Promise<void>;

/**
 * Document registry + ingestion orchestrator.
 *
 * Owns the document list (persisted to `documents.json`) and drives the
 * chunk → embed → extract → link → persist pipeline, emitting @kg/shared
 * `IngestEvent`s for each phase so the SSE route can stream progress.
 */
export class Corpus {
  private documents: Document[] = [];

  constructor(
    private readonly dataDir: string,
    private readonly vectorStore: VectorStore,
    private readonly graphStore: GraphStore,
    private readonly provider: LlmProvider,
  ) {}

  private get filePath(): string {
    return join(this.dataDir, 'documents.json');
  }

  get documentCount(): number {
    return this.documents.length;
  }

  listDocuments(): Document[] {
    return [...this.documents];
  }

  /**
   * Ingest one document end-to-end, emitting progress events.
   * Resolves once everything is persisted (after the `complete` event).
   */
  async ingest(req: IngestRequest, emit: IngestEmit): Promise<Document> {
    const documentId = `doc_${randomUUID()}`;
    const now = new Date().toISOString();

    // 1. Chunking ---------------------------------------------------------
    await emit({ type: 'progress', phase: 'chunking', message: 'Splitting document into chunks', ratio: 0 });
    const texts = chunkText(req.content);
    const chunks: Chunk[] = texts.map((text, index) => ({
      id: `chunk_${documentId}_${index}`,
      documentId,
      index,
      text,
    }));
    await emit({
      type: 'progress',
      phase: 'chunking',
      message: `Produced ${chunks.length} chunk(s)`,
      ratio: 0.15,
    });

    if (chunks.length === 0) {
      await emit({ type: 'error', message: 'Document produced no chunks (empty content).' });
      throw new Error('Document produced no chunks.');
    }

    // 2. Embedding --------------------------------------------------------
    await emit({ type: 'progress', phase: 'embedding', message: 'Embedding chunks', ratio: 0.2 });
    const embeddings = await this.provider.embed(chunks.map((c) => c.text));
    this.vectorStore.add(
      chunks.map((chunk, i) => ({ chunk: { ...chunk, embedding: embeddings[i] }, embedding: embeddings[i]! })),
    );
    await emit({ type: 'progress', phase: 'embedding', message: 'Embeddings computed', ratio: 0.45 });

    // 3. Extraction + 4. Linking -----------------------------------------
    await emit({ type: 'progress', phase: 'extracting', message: 'Extracting entities & relations', ratio: 0.5 });
    const entitiesBefore = this.graphStore.entityCount;
    const relationsBefore = this.graphStore.relationCount;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const extraction = await this.provider.extractGraph(chunk.text);
      this.graphStore.mergeExtraction(extraction.entities, extraction.relations, [chunk.id]);
      const ratio = 0.5 + 0.3 * ((i + 1) / chunks.length);
      await emit({
        type: 'progress',
        phase: 'extracting',
        message: `Extracted from chunk ${i + 1}/${chunks.length}`,
        ratio,
      });
    }

    await emit({ type: 'progress', phase: 'linking', message: 'Linking & scoring graph', ratio: 0.85 });
    // mergeExtraction already recomputes salience; one final pass for safety.
    this.graphStore.recomputeSalience();

    const entityCount = this.graphStore.entityCount - entitiesBefore;
    const relationCount = this.graphStore.relationCount - relationsBefore;

    // 5. Persisting -------------------------------------------------------
    await emit({ type: 'progress', phase: 'persisting', message: 'Persisting stores', ratio: 0.95 });
    const document: Document = {
      id: documentId,
      title: req.title,
      source: req.source,
      chunkCount: chunks.length,
      createdAt: now,
    };
    this.documents.push(document);
    await Promise.all([this.vectorStore.persist(), this.graphStore.persist(), this.persist()]);

    await emit({
      type: 'complete',
      documentId,
      chunkCount: chunks.length,
      entityCount: Math.max(0, entityCount),
      relationCount: Math.max(0, relationCount),
    });

    return document;
  }

  /** Persist the document registry to `${dataDir}/documents.json`. */
  async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.documents), 'utf8');
  }

  /** Load the document registry; no-op if absent. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Document[];
      this.documents = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.documents = [];
        return;
      }
      throw err;
    }
  }

  /** Clear the in-memory registry (stores cleared separately by the caller). */
  clear(): void {
    this.documents = [];
  }
}
