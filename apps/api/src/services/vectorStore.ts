import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Chunk } from '@kg/shared';

/** A stored chunk paired with its dense embedding. */
export interface VectorRecord {
  chunk: Chunk;
  embedding: number[];
}

/** A search hit: the chunk plus its cosine similarity to the query. */
export interface VectorHit {
  chunk: Chunk;
  score: number;
}

/** Cosine similarity of two equal-length vectors (assumes finite numbers). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * In-memory vector store with cosine search and JSON persistence.
 * Suitable for an MVP / demo corpus; not optimized for very large datasets.
 */
export class VectorStore {
  private records: VectorRecord[] = [];

  constructor(private readonly dataDir: string) {}

  private get filePath(): string {
    return join(this.dataDir, 'vectors.json');
  }

  /** Add records (embeddings must already be computed). */
  add(records: VectorRecord[]): void {
    this.records.push(...records);
  }

  /** All stored records (mainly for tests / debugging). */
  all(): readonly VectorRecord[] {
    return this.records;
  }

  get size(): number {
    return this.records.length;
  }

  /** Top-`topK` chunks by cosine similarity to `queryEmbedding`, score-desc. */
  search(queryEmbedding: number[], topK: number): VectorHit[] {
    const scored = this.records.map((r) => ({
      chunk: r.chunk,
      // Clamp into [0,1] since the domain Citation schema requires it; mock
      // embeddings can yield small negative cosines for unrelated text.
      score: Math.max(0, Math.min(1, cosineSimilarity(queryEmbedding, r.embedding))),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Remove all records (in-memory only; call persist() to flush to disk). */
  clear(): void {
    this.records = [];
  }

  /** Persist records to `${dataDir}/vectors.json`. */
  async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.records), 'utf8');
  }

  /** Load records from disk; no-op if the file is absent. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as VectorRecord[];
      this.records = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = [];
        return;
      }
      throw err;
    }
  }
}
