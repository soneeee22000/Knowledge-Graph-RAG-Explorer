# Keyless public deployment (prepared, not executed)

Nothing here is deployed yet. This page gives the exact steps to run the app publicly with no API keys and no paid model calls. It uses the mock provider and the read-only demo mode.

The recommended layout is **one Vercel project** that serves the web app and runs the API as a Vercel Function on the same origin. A Render blueprint is kept as a fallback for the API.

## Read-only demo mode

A public instance must run with `DEMO_READONLY=1`. The mode is covered by `apps/api/src/server.readonly.test.ts` and `apps/api/src/demo/rateLimit.test.ts`.

| Behaviour           | Detail                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seeded on boot      | The stores are cleared and the committed sample (`apps/api/eval/corpus.json`: 10 fictional rail documents, 12 chunks, 51 entities) is ingested. It is bundled into the build, so every instance serves the same corpus after every cold start.                                                   |
| Writes refused      | `POST /api/ingest` and `DELETE /api/corpus` return `403` with `{"error":{"code":"read_only_demo","message":"This is a read-only public demo: ..."}}`.                                                                                                                                            |
| Rate limit          | Per client IP, fixed one-minute window. The default is 60 requests per minute in read-only mode; `RATE_LIMIT_PER_MINUTE` overrides it. Over the limit returns `429` with `Retry-After` and code `rate_limited`. `/api/health` is exempt.                                                         |
| Client IP           | The socket address, unless `TRUST_PROXY=1`, in which case Fastify reads `X-Forwarded-For`. Set it only behind a proxy that overwrites that header (Vercel and Render do). Without it, every request looks like it comes from the proxy.                                                          |
| Web app             | `/api/health` reports `readOnly: true`. The web app then hides the ingest form and the reset button, shows a read-only notice, and suggests questions about the rail corpus.                                                                                                                     |
| Limits of the limit | The counts live in memory, per instance. If the platform runs several instances, each one counts separately, so the effective limit is higher. It is a courtesy limit against casual abuse, not protection against a determined client. For that, use the platform's firewall or WAF rate rules. |

## Environment variables

| Variable                | Where                      | Value for the public demo                                        |
| ----------------------- | -------------------------- | ---------------------------------------------------------------- |
| `DEMO_READONLY`         | API on Render or Cloud Run | `1` (the Vercel Function forces it on)                           |
| `TRUST_PROXY`           | API                        | `1` (behind Vercel or Render only)                               |
| `DATA_DIR`              | API on Vercel              | `/tmp/kg-data` (the only writable path in a Vercel Function)     |
| `RATE_LIMIT_PER_MINUTE` | API, optional              | unset (60) or a number                                           |
| `LLM_PROVIDER`          | API                        | unset or `mock`. Never `baml` on a public instance               |
| `CORS_ORIGIN`           | API on Render only         | the web app's exact origin                                       |
| `VITE_API_URL`          | web, at build time         | `/` when the API is on the same origin; the Render URL otherwise |

No API key is needed anywhere. Do not add `ANTHROPIC_API_KEY` to a public project.

## 0. Check it locally first

This was run on 2026-09-24 (Windows 11, Node 24), from the repo root.

**Built Node bundle, read-only** (the same `node apps/api/dist/index.js` that the Dockerfile and Render run):

```bash
npm install && npm run build
PORT=8793 HOST=127.0.0.1 DEMO_READONLY=1 RATE_LIMIT_PER_MINUTE=3 DATA_DIR=./tmp-data \
  node apps/api/dist/index.js
curl -s http://127.0.0.1:8793/api/health
for i in 1 2 3 4; do curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:8793/api/documents; done
curl -s -X DELETE http://127.0.0.1:8793/api/corpus -H "x-forwarded-for: 9.9.9.9"
```

What came back: health was `{"status":"ok","llmProvider":"mock","documentCount":10,"entityCount":51,"readOnly":true}`. The four `GET /api/documents` calls returned `200 200 200 429`, and the 429 carried `retry-after: 60`. The `DELETE` with a forged `X-Forwarded-For` was still counted against the real socket IP and got `429`, because `TRUST_PROXY` was off.

**The Vercel build output**, built offline. `vercel build` needs a `.vercel/project.json`. For this check one was written by hand with placeholder ids, and nothing was linked or created on Vercel. The file was deleted afterwards; do not commit one.

```bash
mkdir -p .vercel
echo '{"projectId":"prj_localonly","orgId":"team_localonly","settings":{"framework":null,"installCommand":"npm install","buildCommand":"npm run build --workspace @kg/web","outputDirectory":"apps/web/dist","rootDirectory":null}}' > .vercel/project.json
VITE_API_URL=/ vercel build --yes      # Vercel CLI 50.35.0
rm -rf .vercel                          # remove the placeholder before any real `vercel link`
```

On Git Bash for Windows, prefix the build with `MSYS_NO_PATHCONV=1`. Without it, the shell rewrites `/` to `C:/Program Files/Git/` and that path gets compiled into the web bundle. The first attempt here hit this, and the web app reported "Backend offline" until the build was re-run with the prefix.

The build succeeded. It produced `.vercel/output/static` (the web app) and one Node.js 24 function, `functions/api/[...path].func`, of 37 MB. That includes the Windows BAML native addon; a Linux build ships the Linux one instead. Vercel's generated routes send `/api/<one segment>` to the function, which covers every API route. The function was then run locally: its default export mounted on a Node HTTP server, the static files served next to it on one origin (a small stand-in for Vercel's router, not Vercel itself), with `DEMO_READONLY=1 TRUST_PROXY=1`:

- `GET /` returned 200 with the title "KG RAG Explorer".
- `GET /api/health` returned `documentCount: 10`, `entityCount: 51` and `readOnly: true`.
- `POST /api/query` streamed 10 thought events, 2 retrieved events, a graph event, 71 tokens, an answer and `done`.
- `POST /api/ingest` and `DELETE /api/corpus` both returned 403 `read_only_demo`.
- In a headless browser (agent-browser), the page showed the read-only notice, no ingest form or reset button, 51 graph nodes and the three rail suggestions. Clicking "Which company builds the trains that run on the Amber Line?" streamed every step to a final answer. The rerank step read "Added 6 chunk(s) through the graph; 0 made the final top-6." The answer does not name Corvel Works, which is the known miss `m01` in [EVAL.md](EVAL.md).

What this does **not** prove: the Vercel launcher itself, its request-body helpers, streaming through Vercel's edge, and cold-start time were not exercised. Only a real deploy checks those.

## 1. Vercel: web and API in one project (recommended)

Files involved:

- [`vercel.json`](../vercel.json): installs the workspace, builds the web app, and serves `apps/web/dist`.
- [`api/[...path].ts`](../api/%5B...path%5D.ts): re-exports the Node handler from `apps/api/src/vercel.ts`. The handler builds the Fastify app once per instance, seeds the corpus, and forwards each request to it. It **always** runs in read-only mode, whatever `DEMO_READONLY` says (tested in `apps/api/src/vercel.test.ts`). Vercel compiles the TypeScript and traces the dependencies.

Steps, from the repo root, after this branch is merged and pushed:

```bash
vercel login
vercel link --yes --project knowledge-graph-rag-explorer

printf '1' | vercel env add TRUST_PROXY production
printf '/tmp/kg-data' | vercel env add DATA_DIR production
printf '/' | vercel env add VITE_API_URL production
# Optional: printf '0' | vercel env add NODEJS_HELPERS production
#   turns off Vercel's request helpers so Fastify reads the raw body itself.
#   The helpers parse lazily and should not interfere, but this was not tested on Vercel.

vercel deploy --prod
```

Repeat the `env add` lines for `preview` if preview deployments should work too.

Why this layout works for this app: the read-only corpus is rebuilt from the bundle on every cold start, so separate function instances never disagree about what is in it. It depends on read-only mode: a writable corpus would differ from one instance to the next. That is why the Vercel handler forces read-only mode instead of reading it from the environment.

Check the Hobby plan's current function duration and invocation limits before relying on them. A mock query completes in milliseconds, so duration should not matter.

## 2. Fallback: API on Render, web on Vercel

[`render.yaml`](../render.yaml) is a Blueprint for the API only. It uses Docker on the free plan, builds `apps/api/Dockerfile`, and sets `LLM_PROVIDER=mock`, `DEMO_READONLY=1` and `TRUST_PROXY=1`. It health-checks `/api/health`. The Docker image build was not run for this page (the local Docker daemon was off).

1. In the Render dashboard, choose **New → Blueprint**, pick `soneeee22000/Knowledge-Graph-RAG-Explorer`, and let it read `render.yaml`.
2. Render asks for `CORS_ORIGIN`. Enter the Vercel alias from step 3 (use `*` only until that alias exists).
3. Deploy the web app to Vercel as in section 1, but set `VITE_API_URL` to `https://<service>.onrender.com`. The `api/` function is still deployed next to it but goes unused. It is read-only regardless, so it exposes nothing writable.
4. Check `curl -s https://<service>.onrender.com/api/health`; expect `"readOnly":true`.

Free Render instances spin down when idle, so the first request after a pause is slow.

### Alternative: Cloud Run

Cloud Run needs a Google Cloud project with billing enabled, even inside the free tier:

```bash
gcloud run deploy kg-rag-explorer-api \
  --image europe-west1-docker.pkg.dev/<PROJECT_ID>/kg/api:latest \
  --region europe-west1 --allow-unauthenticated --port 8000 --max-instances 1 \
  --set-env-vars "LLM_PROVIDER=mock,DEMO_READONLY=1,TRUST_PROXY=1,CORS_ORIGIN=https://<alias>"
```

Build and push the image first with `docker build -f apps/api/Dockerfile ...` and `docker push`. `--max-instances 1` keeps the rate-limit counts in one place.

## 3. Verify the public URL before linking it anywhere

A 200 alone is not proof, because the page must be this app's:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<alias>
curl -s https://<alias> | grep -i '<title>'                  # expect: KG RAG Explorer
curl -s https://<alias>/api/health                            # expect "readOnly":true, "documentCount":10
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE https://<alias>/api/corpus   # expect 403
curl -s -N -X POST https://<alias>/api/query -H 'content-type: application/json' \
  -d '{"question":"Who chairs the board of the Valdane Transport Authority?"}' | tail -c 300
```

Then open the alias in a browser and click a suggested question. Per-deployment URLs sit behind Vercel login, so share only the production alias. Only after all of this passes should the README or a CV link to the demo, labelled as a live demo on the mock provider.

On 2026-09-24, the guessed alias `https://knowledge-graph-rag-explorer.vercel.app` returned 404: nothing is deployed there.
