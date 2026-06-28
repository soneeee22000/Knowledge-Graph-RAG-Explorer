import { describe, expect, it } from 'vitest';
import {
  EntitySchema,
  IngestRequestSchema,
  QueryEventSchema,
  QueryRequestSchema,
  toSseFrame,
} from './index.js';

describe('schema contracts', () => {
  it('applies defaults for optional entity fields', () => {
    const entity = EntitySchema.parse({ id: 'e1', label: 'Mastra', type: 'technology' });
    expect(entity.properties).toEqual({});
    expect(entity.sourceChunkIds).toEqual([]);
    expect(entity.salience).toBe(0);
  });

  it('rejects an unknown entity type', () => {
    expect(() => EntitySchema.parse({ id: 'e1', label: 'x', type: 'alien' })).toThrow();
  });

  it('defaults query knobs', () => {
    const q = QueryRequestSchema.parse({ question: 'who founded it?' });
    expect(q.topK).toBe(6);
    expect(q.useGraphExpansion).toBe(true);
  });

  it('enforces ingest content limits', () => {
    expect(() => IngestRequestSchema.parse({ title: 't', content: '' })).toThrow();
  });

  it('discriminates query events by type', () => {
    const evt = QueryEventSchema.parse({ type: 'token', value: 'hi' });
    expect(evt.type).toBe('token');
  });

  it('frames events as SSE', () => {
    expect(toSseFrame({ type: 'done' })).toBe('data: {"type":"done"}\n\n');
  });
});
