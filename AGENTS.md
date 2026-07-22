# AGENTS.md

Orientation for AI coding agents (and humans) arriving at this repo: what it is, how to run it, and the conventions worth knowing before making changes.

## What this is
Netlify RAG Chatbot: a production-ready Retrieval-Augmented Generation chatbot deployed as Netlify serverless functions, backed by Neon PostgreSQL and a DeepInfra-hosted LLM. It is a reusable template behind several domain-specific RAG sites: point it at your own embeddings and it serves hybrid (vector + BM25) search with cited answers.

## Stack & layout
- **Frontend**: Vite (TypeScript), built to `dist/`.
- **Backend**: Netlify Functions in `netlify/functions/` (`query`, `query-initiate`, `query-process-background`, `query-status`, `rags`).
- **Data**: Neon PostgreSQL (`@neondatabase/serverless`) with Drizzle ORM; migrations in `drizzle/` and `migrations/`.
- **Deployment scripts**: `scripts/` (RAG deployment, imports, migrations) run via `tsx`.

## Run, test, lint
```bash
npm install
npm run build            # Vite production build to dist/
npm run netlify:dev      # functions + frontend locally
```
Deploy: `netlify deploy --prod --dir=dist --functions=netlify/functions`.

## Conventions
- RAG databases are registered in `src/lib/db/separate-db.ts` (`RAG_DATABASES` + `RAG_METADATA`); `separate-db.ts.example` is the minimal template. This file holds only database names and is safe to commit.
- All credentials live in `.env` (copied from `.env.example`) locally and in the Netlify dashboard for production. See `netlify.toml` for build, functions, and CORS config.
- Embeddings import as a JSON array of `{content, embedding, metadata}` objects; SciBERT uses 768D, MiniLM 384D.

## Gotchas
- Netlify functions time out on large queries. Use the async pair (`/api/query-initiate` + `/api/query-status`) instead of the synchronous `/api/query` for long-running work; `query-process-background` is declared as a background function in `netlify.toml`.
- `DATABASE_URL_BASE` must exclude the database name; the code appends it. An unregistered RAG id raises "Unknown RAG".
