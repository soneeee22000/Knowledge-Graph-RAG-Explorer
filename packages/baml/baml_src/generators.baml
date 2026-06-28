// BAML code generator configuration.
// Run `npm run baml:generate` from the repo root to emit the typed TS client
// into ../baml_client (consumed by the backend's BamlLlmProvider).
generator typescript {
  output_type "typescript"
  output_dir "../"
  version "0.68.0"
}
