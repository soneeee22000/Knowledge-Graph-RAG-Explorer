#!/usr/bin/env node
// Seed the running API with a few sample documents so the graph + RAG have
// something to chew on. Usage: `node scripts/seed.mjs` (API must be running).
const API = process.env.VITE_API_URL ?? 'http://localhost:8000';

const docs = [
  {
    title: 'The European Agentic AI Stack',
    source: 'seed',
    content: `Mastra AI is a TypeScript framework for orchestrating agentic workflows.
It was built by the team behind Gatsby and runs on Node.js. Mastra integrates with
BoundaryML, whose BAML language defines typed LLM functions and generates a strongly
typed client. Many European startups deploy these agents on Google Cloud Platform,
using event-driven services to scale. VueFlow, a Vue 3 library, renders the resulting
agent graphs on an interactive canvas so humans can follow the reasoning.`,
  },
  {
    title: 'Knowledge Graphs meet RAG',
    source: 'seed',
    content: `Retrieval-Augmented Generation grounds a language model in retrieved
documents. A knowledge graph improves RAG by linking entities through typed relations,
letting an agent expand a query along edges rather than relying on vector similarity
alone. NetworkX and graphology are common graph libraries. The combination — vector
retrieval plus graph expansion — is sometimes called GraphRAG and powers more
explainable question answering.`,
  },
];

for (const doc of docs) {
  const res = await fetch(`${API}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok || !res.body) {
    console.error(`Failed to ingest "${doc.title}": ${res.status}`);
    continue;
  }
  // Drain the SSE stream to completion.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  const done = out.includes('"type":"complete"');
  console.log(`${done ? '✓' : '…'} ingested "${doc.title}"`);
}

console.log('Seed complete. Open the web app and ask a question.');
