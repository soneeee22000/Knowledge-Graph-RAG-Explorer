import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/** A plain Node.js request handler, the shape a Vercel Node function exports. */
export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Default data directory in a function: the deployment bundle is read-only, the temp dir is not. */
export const SERVERLESS_DATA_DIR = join(tmpdir(), 'kg-data');

/**
 * The environment the function runs with: read-only mode forced on, and
 * DATA_DIR in the temp directory unless one is set explicitly.
 */
export function serverlessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, DATA_DIR: env.DATA_DIR || SERVERLESS_DATA_DIR, DEMO_READONLY: '1' };
}

/**
 * Wrap the Fastify app as a Node handler for a serverless function. The app
 * and its seeded corpus are built once per instance on the first request and
 * reused while the instance stays warm. Read-only mode is forced: separate
 * serverless instances cannot share a writable in-memory corpus.
 */
export function createVercelHandler(env: NodeJS.ProcessEnv = process.env): NodeHandler {
  let appPromise: Promise<FastifyInstance> | undefined;
  const app = (): Promise<FastifyInstance> => {
    appPromise ??= buildServer({ config: loadConfig(serverlessEnv(env)) })
      .then(async (built) => {
        await built.ready();
        return built;
      })
      .catch((err: unknown) => {
        appPromise = undefined;
        throw err;
      });
    return appPromise;
  };
  return async (req, res) => {
    (await app()).server.emit('request', req, res);
  };
}

export default createVercelHandler();
