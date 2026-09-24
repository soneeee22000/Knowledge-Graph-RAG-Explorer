# Keyless deployment (prepared, not executed)

Nothing here is deployed yet. This page lists the exact steps to run the app publicly in mock mode: no API keys and no paid model calls. The web app goes on Vercel and the API goes on a free tier (Render, or Cloud Run as an alternative).

The web app is a static Vite build. `VITE_API_URL` is compiled into it at build time, so the API has to exist first.

## 0. Check it locally first

This was run on 2026-09-24 (Windows 11, Node 24) against the built bundle, the same `node apps/api/dist/index.js` the API Dockerfile runs:

```bash
npm install
npm run build

# API, mock provider, restricted CORS
PORT=8765 LLM_PROVIDER=mock DATA_DIR=./tmp-data CORS_ORIGIN=http://localhost:4173 \
  node apps/api/dist/index.js

# in a second terminal
curl -s http://localhost:8765/api/health
VITE_API_URL=http://localhost:8765 node scripts/seed.mjs
curl -s -N -X POST http://localhost:8765/api/query \
  -H 'content-type: application/json' -d '{"question":"What is Mastra built with?"}'

# web, pointed at that API
cd apps/web && VITE_API_URL=http://localhost:8765 npx vite build && npx vite preview --port 4173
```

What came back: health reported `llmProvider: "mock"`. Seeding ingested 2 documents into a graph of 17 entities and 11 relations. The query streamed 10 thought events, 2 retrieved events, a graph event, 44 tokens, an answer and `done`. A CORS preflight from `http://localhost:4173` was allowed, and one from another origin got no `Access-Control-Allow-Origin` header. The preview served the page (200, title "KG RAG Explorer"), and its bundle had the API URL compiled in. The UI was not clicked through in a browser during this check.

## 1. API on Render (free plan)

[`render.yaml`](../render.yaml) is a Blueprint for the API only. It uses the Docker runtime on the free plan, builds `apps/api/Dockerfile` from the repo root, sets `LLM_PROVIDER=mock`, and health-checks `/api/health`. Render sets `PORT`, which the API reads.

1. Merge this branch and push it to GitHub.
2. In the Render dashboard, choose **New → Blueprint**, pick `soneeee22000/Knowledge-Graph-RAG-Explorer`, and let it read `render.yaml`.
3. Render asks for `CORS_ORIGIN`. Enter `*` for this first deploy. Step 3 tightens it.
4. When the deploy finishes, check it:

   ```bash
   curl -s https://<your-service>.onrender.com/api/health
   # expect {"status":"ok","llmProvider":"mock",...}
   ```

Free instances spin down when idle, so the first request after a pause is slow. They also have no persistent disk: the corpus is lost on every restart or redeploy. Check Render's current free-tier terms before relying on either behaviour.

### Alternative: Cloud Run

Cloud Run needs a Google Cloud project with billing enabled, even when usage stays inside the free tier. Run these from the repo root:

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud artifacts repositories create kg --repository-format=docker --location=europe-west1
gcloud auth configure-docker europe-west1-docker.pkg.dev

docker build -f apps/api/Dockerfile -t europe-west1-docker.pkg.dev/<PROJECT_ID>/kg/api:latest .
docker push europe-west1-docker.pkg.dev/<PROJECT_ID>/kg/api:latest

gcloud run deploy kg-rag-explorer-api \
  --image europe-west1-docker.pkg.dev/<PROJECT_ID>/kg/api:latest \
  --region europe-west1 --allow-unauthenticated --port 8000 \
  --max-instances 1 --set-env-vars "LLM_PROVIDER=mock,CORS_ORIGIN=*"
```

`--max-instances 1` matters. The stores are held in memory per instance, so two instances would each show a different graph.

The Docker image build was not run for this page (the local Docker daemon was off). The Dockerfile itself was not changed.

## 2. Web on Vercel

[`vercel.json`](../vercel.json) at the repo root installs the workspace, runs `npm run build --workspace @kg/web`, and serves `apps/web/dist`. That build command was run from a clean `dist/` and it succeeds. Run these from the repo root:

```bash
vercel login
vercel link --yes --project knowledge-graph-rag-explorer
vercel env add VITE_API_URL production      # paste https://<your-api-host>, no trailing slash
vercel deploy --prod
```

Because `VITE_API_URL` is compiled into the build, you have to redeploy the web app whenever the API URL changes.

## 3. Close CORS and verify

1. Find the production alias with `vercel inspect <deployment-url>`. Per-deployment URLs sit behind Vercel login, so share only the alias.
2. On the API, set `CORS_ORIGIN` to exactly that alias, for example `https://knowledge-graph-rag-explorer.vercel.app`, and redeploy the API.
3. Check both hosts. A 200 alone is not proof, because the page title has to be this app's:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<alias>
   curl -s https://<alias> | grep -i '<title>'        # expect: KG RAG Explorer
   curl -s https://<api-host>/api/health
   curl -s -i -X OPTIONS https://<api-host>/api/query \
     -H 'origin: https://<alias>' -H 'access-control-request-method: POST' \
     | grep -i access-control-allow-origin
   ```

4. Open the alias, click **Load sample → Ingest**, and ask a question. Only after this passes should the README or a CV link to the demo.

On 2026-09-24, the guessed alias `https://knowledge-graph-rag-explorer.vercel.app` returned 404: nothing is deployed there.

## Before making it public

These are known risks. None of them is fixed yet:

- **`DELETE /api/corpus` has no auth.** Any visitor can wipe the demo for everyone.
- **One shared corpus.** Whatever a visitor pastes is visible to every other visitor through `/api/documents` and `/api/graph`.
- **No rate limit.** The only size cap is the 200,000-character limit per ingest request. A free instance has little memory.
- **Empty on cold start.** After a restart, visitors see an empty graph until someone clicks **Load sample**.

A read-only demo mode would address all four: seed the sample on boot, and turn off custom ingest and the delete route. That mode is not built.
