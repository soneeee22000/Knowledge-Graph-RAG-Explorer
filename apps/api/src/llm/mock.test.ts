import { describe, expect, it } from 'vitest';
import { embedText, MockLlmProvider, MOCK_EMBED_DIM } from './mock.js';

const PARAGRAPH =
  'Mastra AI builds agent frameworks in TypeScript. ' +
  'The Mastra framework integrates with BAML for structured extraction. ' +
  'OpenAI and Anthropic provide the language models that power these agents.';

describe('MockLlmProvider embeddings', () => {
  it('produces deterministic, fixed-dim, L2-normalized vectors', async () => {
    const provider = new MockLlmProvider();
    const [a] = await provider.embed(['hello world']);
    const [b] = await provider.embed(['hello world']);
    expect(a).toEqual(b); // deterministic
    expect(a).toHaveLength(MOCK_EMBED_DIM);
    const norm = Math.sqrt(a!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5); // unit length
  });

  it('gives more similar texts higher dot product than unrelated ones', () => {
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    const base = embedText('mastra agent framework typescript');
    const similar = embedText('the mastra agent framework in typescript');
    const unrelated = embedText('bananas grow on tropical island farms');
    expect(dot(base, similar)).toBeGreaterThan(dot(base, unrelated));
  });
});

describe('MockLlmProvider graph extraction', () => {
  it('extracts a non-empty graph from a real paragraph', async () => {
    const provider = new MockLlmProvider();
    const { entities, relations } = await provider.extractGraph(PARAGRAPH);
    expect(entities.length).toBeGreaterThan(0);
    const labels = entities.map((e) => e.label);
    expect(labels.some((l) => /Mastra/i.test(l))).toBe(true);
    // Co-occurring entities in a sentence should yield at least one relation.
    expect(relations.length).toBeGreaterThan(0);
  });
});

describe('MockLlmProvider answer', () => {
  it('stitches relevant context sentences', async () => {
    const provider = new MockLlmProvider();
    const answer = await provider.answer('What does Mastra build?', PARAGRAPH);
    expect(answer.length).toBeGreaterThan(0);
    expect(/Mastra/i.test(answer)).toBe(true);
  });
});
