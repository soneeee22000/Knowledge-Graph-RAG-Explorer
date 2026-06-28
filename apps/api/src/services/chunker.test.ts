import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Hello world. This is short.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Hello world');
  });

  it('splits long text into multiple chunks on sentence boundaries', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(40); // ~1800 chars
    const chunks = chunkText(text, { targetSize: 600, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be roughly within the target (plus overlap slack).
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(900);
    }
  });

  it('produces overlap between consecutive chunks', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has some words.`);
    const text = sentences.join(' ');
    const chunks = chunkText(text, { targetSize: 300, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    // The last sentence(s) of chunk[0] should reappear at the start of chunk[1].
    const tailOfFirst = chunks[0]!.split(' ').slice(-3).join(' ');
    expect(chunks[1]).toContain(tailOfFirst);
  });

  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });
});
