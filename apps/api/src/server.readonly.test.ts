import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from './config.js';
import { DEMO_SAMPLE_DOCUMENT_COUNT } from './demo/seed.js';
import { MockLlmProvider } from './llm/mock.js';
import { buildServer } from './server.js';
import { AppStores } from './services/stores.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];

async function start(env: Record<string, string>): Promise<FastifyInstance> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kg-readonly-'));
  dirs.push(dataDir);
  const config: Config = loadConfig({ DATA_DIR: dataDir, ...env });
  const app = await buildServer({ config, stores: new AppStores(dataDir, new MockLlmProvider()) });
  apps.push(app);
  return app;
}

function getFrom(app: FastifyInstance, url: string, ip: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, remoteAddress: ip });
}

const INGEST_BODY = { title: 'Mine', source: 'test', content: 'Zephyr trains run on Mars.' };
const MANY_REQUESTS = 200;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('config', () => {
  it('reads DEMO_READONLY, RATE_LIMIT_PER_MINUTE and TRUST_PROXY', () => {
    const config = loadConfig({
      DEMO_READONLY: '1',
      RATE_LIMIT_PER_MINUTE: '5',
      TRUST_PROXY: 'true',
    });
    expect(config.DEMO_READONLY).toBe(true);
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(5);
    expect(config.TRUST_PROXY).toBe(true);
    expect(loadConfig({}).DEMO_READONLY).toBe(false);
    expect(loadConfig({}).TRUST_PROXY).toBe(false);
  });
});

describe('read-only demo mode', () => {
  it('seeds the committed sample corpus on boot and says so in health', async () => {
    const app = await start({ DEMO_READONLY: '1' });
    const health = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(health.readOnly).toBe(true);
    expect(health.documentCount).toBe(DEMO_SAMPLE_DOCUMENT_COUNT);
    expect(health.entityCount).toBeGreaterThan(0);
  });

  it('refuses custom ingest with a 403 and a clear message', async () => {
    const app = await start({ DEMO_READONLY: '1' });
    const res = await app.inject({ method: 'POST', url: '/api/ingest', payload: INGEST_BODY });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('read_only_demo');
    expect(res.json().error.message).toMatch(/read-only/i);
  });

  it('refuses DELETE /api/corpus with a 403 and keeps the corpus', async () => {
    const app = await start({ DEMO_READONLY: '1' });
    const res = await app.inject({ method: 'DELETE', url: '/api/corpus' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('read_only_demo');
    const docs = (await app.inject({ method: 'GET', url: '/api/documents' })).json();
    expect(docs.documents).toHaveLength(DEMO_SAMPLE_DOCUMENT_COUNT);
  });

  it('still answers queries over the seeded corpus', async () => {
    const app = await start({ DEMO_READONLY: '1' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { question: 'Who chairs the board of the Valdane Transport Authority?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"type":"answer"');
    expect(res.body).toContain('Governance');
  });

  it('rate-limits each client IP and returns 429 with Retry-After', async () => {
    const app = await start({ DEMO_READONLY: '1', RATE_LIMIT_PER_MINUTE: '2' });
    expect((await getFrom(app, '/api/documents', '10.0.0.1')).statusCode).toBe(200);
    expect((await getFrom(app, '/api/documents', '10.0.0.1')).statusCode).toBe(200);
    const limited = await getFrom(app, '/api/documents', '10.0.0.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json().error.code).toBe('rate_limited');
    expect((await getFrom(app, '/api/documents', '10.0.0.2')).statusCode).toBe(200);
  });

  it('never rate-limits the health check', async () => {
    const app = await start({ DEMO_READONLY: '1', RATE_LIMIT_PER_MINUTE: '1' });
    for (let i = 0; i < 3; i++) {
      expect((await getFrom(app, '/api/health', '10.0.0.3')).statusCode).toBe(200);
    }
  });

  it('applies a default rate limit in demo mode when none is configured', async () => {
    const app = await start({ DEMO_READONLY: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < MANY_REQUESTS; i++) {
      statuses.push((await getFrom(app, '/api/graph', '10.0.0.4')).statusCode);
    }
    expect(statuses).toContain(429);
  });
});

describe('default (writable) mode', () => {
  it('starts empty, allows ingest and delete, and reports readOnly false', async () => {
    const app = await start({});
    const health = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(health.readOnly).toBe(false);
    expect(health.documentCount).toBe(0);
    const ingest = await app.inject({ method: 'POST', url: '/api/ingest', payload: INGEST_BODY });
    expect(ingest.statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: '/api/corpus' });
    expect(del.statusCode).toBe(204);
  });

  it('does not rate-limit unless asked to', async () => {
    const app = await start({});
    for (let i = 0; i < MANY_REQUESTS; i++) {
      expect((await getFrom(app, '/api/graph', '10.0.0.5')).statusCode).toBe(200);
    }
  });
});
