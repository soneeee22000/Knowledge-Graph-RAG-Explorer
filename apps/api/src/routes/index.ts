import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  IngestRequestSchema,
  QueryRequestSchema,
  toSseFrame,
  type ApiError,
  type DocumentListResponse,
  type HealthResponse,
  type IngestEvent,
  type KnowledgeGraph,
  type QueryEvent,
} from '@kg/shared';
import { runRagQuery } from '../agents/ragAgent.js';
import type { AppStores } from '../services/stores.js';

/** Build an ApiError envelope. */
function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Prepare a Fastify reply for Server-Sent Events streaming.
 *
 * We hijack the reply to write the raw socket directly; that bypasses the
 * `@fastify/cors` onSend hook, so we re-apply the CORS origin header here
 * (echoing the request origin, falling back to `*`).
 */
function startSse(request: FastifyRequest, reply: FastifyReply): void {
  // Take over the raw socket so Fastify doesn't try to send/serialize a reply.
  reply.hijack();
  const origin = (request.headers.origin as string | undefined) ?? '*';
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  });
}

/** Write one SSE frame and flush. */
function writeSse(reply: FastifyReply, event: unknown): void {
  reply.raw.write(toSseFrame(event));
  // Flush if the underlying stream supports it (compression middlewares etc.).
  const flush = (reply.raw as unknown as { flush?: () => void }).flush;
  if (typeof flush === 'function') flush.call(reply.raw);
}

/** Register all `/api` routes against the shared stores. */
export function registerRoutes(app: FastifyInstance, stores: AppStores): void {
  // GET /api/health ----------------------------------------------------
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      llmProvider: stores.provider.name,
      documentCount: stores.corpus.documentCount,
      entityCount: stores.graphStore.entityCount,
    };
  });

  // GET /api/documents -------------------------------------------------
  app.get('/api/documents', async (): Promise<DocumentListResponse> => {
    return { documents: stores.corpus.listDocuments() };
  });

  // GET /api/graph -----------------------------------------------------
  app.get('/api/graph', async (): Promise<KnowledgeGraph> => {
    return stores.graphStore.toKnowledgeGraph();
  });

  // POST /api/ingest (SSE) ---------------------------------------------
  app.post('/api/ingest', async (request, reply) => {
    const parsed = IngestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(apiError('invalid_request', parsed.error.message));
      return;
    }

    startSse(request, reply);
    const emit = (event: IngestEvent): void => writeSse(reply, event);
    try {
      await stores.corpus.ingest(parsed.data, emit);
    } catch (err) {
      // ingest() already emits a structured error for known failures; this is a
      // safety net for unexpected throws.
      const message = err instanceof Error ? err.message : String(err);
      writeSse(reply, { type: 'error', message } satisfies IngestEvent);
    } finally {
      reply.raw.end();
    }
  });

  // POST /api/query (SSE) ----------------------------------------------
  app.post('/api/query', async (request, reply) => {
    const parsed = QueryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(apiError('invalid_request', parsed.error.message));
      return;
    }

    startSse(request, reply);
    const emit = (event: QueryEvent): void => writeSse(reply, event);
    try {
      await runRagQuery(stores, parsed.data, emit);
    } finally {
      reply.raw.end();
    }
  });

  // DELETE /api/corpus -------------------------------------------------
  app.delete('/api/corpus', async (_request, reply) => {
    await stores.clearAll();
    reply.code(204).send();
  });
}
