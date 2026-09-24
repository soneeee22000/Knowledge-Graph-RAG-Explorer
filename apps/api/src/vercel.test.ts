import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVercelHandler, serverlessEnv } from './vercel.js';

interface Health {
  readOnly: boolean;
  documentCount: number;
}

interface Documents {
  documents: Array<{ id: string }>;
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const handler = createVercelHandler({
    DEMO_READONLY: '1',
    DATA_DIR: join(tmpdir(), 'kg-vercel-test'),
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('createVercelHandler', () => {
  it('serves the API through a plain Node request handler, seeded read-only', async () => {
    const health = await getJson<Health>(`${baseUrl}/api/health`);
    expect(health.readOnly).toBe(true);
    expect(health.documentCount).toBeGreaterThan(0);
  });

  it('streams a query answer over SSE', async () => {
    const res = await fetch(`${baseUrl}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Which company replaced the signalling on the Amber Line?',
      }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('"type":"done"');
  });

  it('builds the app once and reuses it across requests', async () => {
    const first = await getJson<Documents>(`${baseUrl}/api/documents`);
    const second = await getJson<Documents>(`${baseUrl}/api/documents`);
    expect(second.documents.map((d) => d.id)).toEqual(first.documents.map((d) => d.id));
  });

  it('refuses ingest on the read-only deployment', async () => {
    const res = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', content: 'y' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('createVercelHandler without DEMO_READONLY', () => {
  it('still runs read-only, because a writable corpus cannot survive serverless instances', async () => {
    const handler = createVercelHandler({ DATA_DIR: join(tmpdir(), 'kg-vercel-forced') });
    const plain = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    try {
      const health = await getJson<Health>(`${url}/api/health`);
      expect(health.readOnly).toBe(true);
      const res = await fetch(`${url}/api/corpus`, { method: 'DELETE' });
      expect(res.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => plain.close(() => resolve()));
    }
  });
});

describe('serverlessEnv', () => {
  it('forces read-only mode whatever the environment says', () => {
    expect(serverlessEnv({ DEMO_READONLY: '0' }).DEMO_READONLY).toBe('1');
  });

  it('defaults DATA_DIR to the OS temp directory, the only writable path in a function', () => {
    expect(serverlessEnv({}).DATA_DIR).toBe(join(tmpdir(), 'kg-data'));
  });

  it('keeps an explicit DATA_DIR', () => {
    expect(serverlessEnv({ DATA_DIR: '/tmp/custom' }).DATA_DIR).toBe('/tmp/custom');
  });
});
