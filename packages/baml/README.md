# @kg/baml — LLM integration via BoundaryML (BAML)

BAML defines our LLM functions as typed contracts (`.baml` files in
[`baml_src/`](./baml_src)) and generates a fully-typed TypeScript client. The
backend's `BamlLlmProvider` consumes that generated client; the prompt, output
schema, model, and provider-fallback strategy all live here, decoupled from app
code.

## Functions

| Function                | Input               | Output            | Purpose                                                      |
| ----------------------- | ------------------- | ----------------- | ------------------------------------------------------------ |
| `ExtractKnowledgeGraph` | `chunk: string`     | `GraphExtraction` | Pull entities + typed relations from a text chunk            |
| `AnswerQuestion`        | `question, context` | `GroundedAnswer`  | Answer strictly from retrieved context, naming entities used |

## Clients

`clients.baml` defines `Claude`, `GPT4o`, and `Mistral` clients plus a `Primary`
fallback chain (Claude → GPT-4o → Mistral). Swap providers without touching a
line of application code.

## Generate the client

```bash
# from the repo root
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY / MISTRAL_API_KEY
npm run baml:generate          # emits ../baml_client (gitignored)
```

The generated `baml_client/` is intentionally git-ignored. The app runs without
it (and without any API key) via the deterministic `MockLlmProvider`; generate
the client and set `LLM_PROVIDER=baml` to use real models.
