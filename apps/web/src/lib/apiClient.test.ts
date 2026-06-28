import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryEventSchema } from '@kg/shared';
import type { QueryEvent } from '@kg/shared';
import { streamSse } from './apiClient';

/** Build a ReadableStream that emits the given string chunks as Uint8Arrays. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetch(chunks: string[], ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok,
        status,
        body: streamFromChunks(chunks),
      } as unknown as Response),
    ),
  );
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamSse', () => {
  it('parses and validates well-formed SSE frames', async () => {
    const frames = [
      `data: ${JSON.stringify({ type: 'token', value: 'Hello ' })}\n\n`,
      `data: ${JSON.stringify({ type: 'token', value: 'world' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ];
    mockFetch(frames);

    const events = await collect(
      streamSse<QueryEvent>('/api/query', {}, QueryEventSchema),
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'token', value: 'Hello ' });
    expect(events[1]).toEqual({ type: 'token', value: 'world' });
    expect(events[2]).toEqual({ type: 'done' });
  });

  it('reassembles frames split across network chunks', async () => {
    // A single frame delivered in three byte-level pieces.
    const full = `data: ${JSON.stringify({ type: 'token', value: 'split' })}\n\n`;
    const mid = Math.floor(full.length / 2);
    mockFetch([full.slice(0, 5), full.slice(5, mid), full.slice(mid)]);

    const events = await collect(
      streamSse<QueryEvent>('/api/query', {}, QueryEventSchema),
    );

    expect(events).toEqual([{ type: 'token', value: 'split' }]);
  });

  it('ignores SSE comments / heartbeats and flushes a trailing frame', async () => {
    mockFetch([
      `: keep-alive\n\n`,
      `data: ${JSON.stringify({ type: 'token', value: 'tail' })}`, // no trailing \n\n
    ]);

    const events = await collect(
      streamSse<QueryEvent>('/api/query', {}, QueryEventSchema),
    );

    expect(events).toEqual([{ type: 'token', value: 'tail' }]);
  });

  it('rejects when the response is not ok', async () => {
    mockFetch([], false, 500);
    await expect(
      collect(streamSse('/api/query', {}, QueryEventSchema)),
    ).rejects.toThrow(/failed \(500\)/);
  });

  it('throws on a payload that violates the schema', async () => {
    mockFetch([`data: ${JSON.stringify({ type: 'nope' })}\n\n`]);
    await expect(
      collect(streamSse('/api/query', {}, QueryEventSchema)),
    ).rejects.toThrow();
  });
});
