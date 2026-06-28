/**
 * Sentence-aware text chunking.
 *
 * Produces ~`targetSize`-character chunks that break on sentence boundaries and
 * carry a small overlap so retrieval doesn't lose context that straddles a cut.
 */

export interface ChunkOptions {
  /** Soft target chunk size in characters. */
  targetSize?: number;
  /** Approximate character overlap between consecutive chunks. */
  overlap?: number;
}

const DEFAULT_TARGET = 600;
const DEFAULT_OVERLAP = 100;

/** Split text into sentences on terminal punctuation, keeping the punctuation. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Chunk `text` into overlapping segments on sentence boundaries.
 *
 * Each chunk grows by whole sentences until it reaches `targetSize`, then the
 * next chunk re-includes trailing sentences from the previous one to provide
 * ~`overlap` characters of shared context.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const targetSize = options.targetSize ?? DEFAULT_TARGET;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = (): string[] => {
    if (current.length === 0) return [];
    chunks.push(current.join(' '));
    // Build the overlap seed: take trailing sentences up to ~`overlap` chars.
    const seed: string[] = [];
    let seedLen = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const s = current[i]!;
      if (seedLen + s.length > overlap && seed.length > 0) break;
      seed.unshift(s);
      seedLen += s.length + 1;
    }
    return seed;
  };

  for (const sentence of sentences) {
    // A single oversized sentence becomes its own chunk.
    if (sentence.length >= targetSize) {
      if (current.length > 0) {
        current = flush();
        currentLen = current.reduce((n, s) => n + s.length + 1, 0);
      }
      chunks.push(sentence);
      current = [];
      currentLen = 0;
      continue;
    }

    if (currentLen + sentence.length + 1 > targetSize && current.length > 0) {
      current = flush();
      currentLen = current.reduce((n, s) => n + s.length + 1, 0);
    }

    current.push(sentence);
    currentLen += sentence.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current.join(' '));
  }

  return chunks;
}
