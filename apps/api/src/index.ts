import { config } from './config.js';
import { buildServer } from './server.js';

/** Entry point: build the server and start listening. */
async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(
      `[kg-api] listening on http://${config.HOST}:${config.PORT} (provider=${config.LLM_PROVIDER})`,
    );
  } catch (err) {
    console.error('[kg-api] failed to start', err);
    process.exit(1);
  }
}

void main();
