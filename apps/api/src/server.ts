import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, type Config } from './config.js';
import { registerRoutes } from './routes/index.js';
import { AppStores } from './services/stores.js';

export interface BuildServerOptions {
  config?: Config;
  /** Inject pre-built stores (used by tests); otherwise constructed from config. */
  stores?: AppStores;
}

/**
 * Build the Fastify app: CORS, routes, and shared stores.
 * On boot, persisted stores are loaded from `DATA_DIR` (empty is fine).
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const cfg = options.config ?? config;
  const stores = options.stores ?? new AppStores(cfg.DATA_DIR);
  await stores.load();

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(',').map((s) => s.trim()),
  });

  registerRoutes(app, stores);

  // Expose stores for tests / introspection.
  app.decorate('stores', stores);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    stores: AppStores;
  }
}
