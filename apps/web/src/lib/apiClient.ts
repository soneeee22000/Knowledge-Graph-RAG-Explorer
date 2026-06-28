import type { z } from 'zod';
import {
  DocumentListResponseSchema,
  HealthResponseSchema,
  KnowledgeGraphSchema,
  IngestEventSchema,
  QueryEventSchema,
} from '@kg/shared';
import type {
  DocumentListResponse,
  HealthResponse,
  KnowledgeGraph,
  IngestEvent,
  IngestRequest,
  QueryEvent,
  QueryRequest,
} from '@kg/shared';

/** Base URL for the backend; configurable per-environment via Vite env. */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed (${res.status})`, res.status);
  }
  const data: unknown = await res.json();
  return schema.parse(data);
}

export function getHealth(): Promise<HealthResponse> {
  return getJson('/api/health', HealthResponseSchema);
}

export function getDocuments(): Promise<DocumentListResponse> {
  return getJson('/api/documents', DocumentListResponseSchema);
}

export function getGraph(): Promise<KnowledgeGraph> {
  return getJson('/api/graph', KnowledgeGraphSchema);
}

export async function resetCorpus(): Promise<void> {
  const res = await fetch(`${API_URL}/api/corpus`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new ApiError(`DELETE /api/corpus failed (${res.status})`, res.status);
  }
}

/**
 * Consume a POST SSE stream as an async generator of validated events.
 *
 * The backend emits `data: <json>\n\n` frames. Because the request is a POST we
 * cannot use `EventSource`; instead we read the response body ourselves, buffer
 * bytes, split on the SSE record separator (`\n\n`), strip the `data: ` prefix,
 * JSON-parse, and validate each frame against the provided zod schema so no
 * malformed event can leak into the UI.
 */
export async function* streamSse<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    throw new ApiError(`POST ${url} failed (${res.status})`, res.status);
  }
  if (!res.body) {
    throw new ApiError('Response had no readable body', res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      let sep: number;
      // SSE records are separated by a blank line (\n\n).
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawRecord = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseRecord(rawRecord, schema);
        if (event !== undefined) {
          yield event;
        }
      }

      if (done) {
        break;
      }
    }

    // Flush any trailing record that wasn't terminated by a blank line.
    const tail = (buffer + decoder.decode()).trim();
    if (tail.length > 0) {
      const event = parseSseRecord(tail, schema);
      if (event !== undefined) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse one SSE record (which may contain multiple `data:` lines, per spec)
 * into a validated event, or `undefined` for comment/heartbeat-only records.
 */
function parseSseRecord<T>(
  record: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T | undefined {
  const dataLines: string[] = [];
  for (const line of record.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.length === 0 || trimmed.startsWith(':')) {
      continue; // blank line or SSE comment / heartbeat
    }
    if (trimmed.startsWith('data:')) {
      // Per spec a single leading space after the colon is stripped.
      dataLines.push(trimmed.slice(5).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  const payload = dataLines.join('\n');
  const json: unknown = JSON.parse(payload);
  return schema.parse(json);
}

export function streamQuery(body: QueryRequest, signal?: AbortSignal): AsyncGenerator<QueryEvent> {
  return streamSse(`${API_URL}/api/query`, body, QueryEventSchema, signal);
}

export function streamIngest(
  body: IngestRequest,
  signal?: AbortSignal,
): AsyncGenerator<IngestEvent> {
  return streamSse(`${API_URL}/api/ingest`, body, IngestEventSchema, signal);
}
