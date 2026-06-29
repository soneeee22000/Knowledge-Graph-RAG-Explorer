import { defineConfig } from 'tsup';

/**
 * Keep the native `@boundaryml/baml` addon external (it must load from
 * node_modules at runtime) but fix its subpath imports for Node's strict ESM
 * resolver: the generated BAML client imports `@boundaryml/baml/native` and
 * `.../type_builder` without an extension, which Node ESM rejects. Append the
 * `.js` Node needs. This plugin owns all `@boundaryml/baml` resolution (the
 * `external` config option is matched before plugins, so it can't be used here).
 */
const bamlExternalWithExt = {
  name: 'baml-external-with-ext',
  setup(build: {
    onResolve: (
      opts: { filter: RegExp },
      cb: (args: { path: string }) => { path: string; external: true },
    ) => void;
  }): void {
    build.onResolve({ filter: /^@boundaryml\/baml(\/.*)?$/ }, (args) => {
      const subpath = args.path.slice('@boundaryml/baml'.length); // '' or '/native'
      const isExtensionlessSubpath = subpath.startsWith('/') && !subpath.includes('.');
      return {
        path: isExtensionlessSubpath ? `${args.path}.js` : args.path,
        external: true,
      };
    });
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // The generated @kg/baml client is TypeScript-only (no compiled JS is ever
  // emitted), so a plain `node dist/index.js` runtime can't import it. Bundle it
  // into the API output; @boundaryml/baml stays external via the plugin above.
  noExternal: ['@kg/baml'],
  esbuildPlugins: [bamlExternalWithExt],
});
