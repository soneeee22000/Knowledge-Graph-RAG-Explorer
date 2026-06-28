import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config.
 *
 * Resolve `@kg/shared` to the workspace source so tests run without a build
 * step. The root workspace install also symlinks the package into node_modules,
 * but this alias keeps tests fast and independent of build order.
 */
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@kg/shared': sharedSrc,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
