import { describe, expect, it } from 'vitest';
import { DEMO_SUGGESTIONS, LOCAL_SUGGESTIONS, suggestionsFor } from './suggestions';

describe('suggestionsFor', () => {
  it('suggests questions about the seeded rail corpus on the read-only demo', () => {
    expect(suggestionsFor(true)).toBe(DEMO_SUGGESTIONS);
    expect(DEMO_SUGGESTIONS.some((q) => /Amber Line|Valdane/.test(q))).toBe(true);
  });

  it('keeps the sample-passage questions for local use', () => {
    expect(suggestionsFor(false)).toBe(LOCAL_SUGGESTIONS);
  });
});
