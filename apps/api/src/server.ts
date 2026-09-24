import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, type Config } from './config.js';
import { FixedWindowRateLimiter } from './demo/rateLimit.js';
import { seedDemoCorpus } from './demo/seed.js';
import { apiError, registerRoutes } from './routes/index.js';
import { AppStores } from './services/stores.js';

/** Requests per IP per minute on the read-only demo when RATE_LIMIT_PER_MINUTE is unset. */
export const DEMO_DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_EXEMPT_PATHS = new Set(['/api/health']);
/**
 * With TRUST_PROXY, trust exactly one proxy hop: the client IP is the last
 * X-Forwarded-For entry, the one the platform's proxy wrote. Entries a client
 * sends ahead of it are ignored, so they cannot be used to dodge the limit.
 */
const TRUSTED_PROXY_HOPS = 1;

/** The per-minute limit in force, or undefined when rate limiting is off. */
export function effectiveRateLimit(cfg: Config): number | undefined {
  return (
    cfg.RATE_LIMIT_PER_MINUTE ??
    (cfg.DEMO_READONLY ? DEMO_DEFAULT_RATE_LIMIT_PER_MINUTE : undefined)
  );
}

function registerRateLimit(app: FastifyInstance, perMinute: number): void {
  const limiter = new FixedWindowRateLimiter(perMinute, RATE_LIMIT_WINDOW_MS);
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    if (RATE_LIMIT_EXEMPT_PATHS.has(request.url.split('?')[0] ?? '')) return;
    const decision = limiter.take(request.ip);
    if (decision.allowed) return;
    reply
      .code(429)
      .header('retry-after', String(decision.retryAfterSeconds))
      .send(
        apiError('rate_limited', `Too many requests. Try again in ${decision.retryAfterSeconds}s.`),
      );
    return reply;
  });
}

export interface BuildServerOptions {
  config?: Config;
  /** Inject pre-built stores (used by tests); otherwise constructed from config. */
  stores?: AppStores;
}

/**
 * Build the Fastify app: CORS, routes, and shared stores.
 * On boot, persisted stores are loaded from `DATA_DIR` (empty is fine). With
 * `DEMO_READONLY` the committed sample replaces them and writes are refused;
 * a per-IP rate limit applies when one is configured or in read-only mode.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const cfg = options.config ?? config;
  const stores = options.stores ?? new AppStores(cfg.DATA_DIR);
  await stores.load();
  if (cfg.DEMO_READONLY) await seedDemoCorpus(stores);

  const app = Fastify({ logger: false, trustProxy: cfg.TRUST_PROXY ? TRUSTED_PROXY_HOPS : false });

  await app.register(cors, {
    origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(',').map((s) => s.trim()),
  });

  const rateLimit = effectiveRateLimit(cfg);
  if (rateLimit !== undefined) registerRateLimit(app, rateLimit);

  registerRoutes(app, stores, { readOnly: cfg.DEMO_READONLY });

  // Expose stores for tests / introspection.
  app.decorate('stores', stores);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    stores: AppStores;
  }
}
