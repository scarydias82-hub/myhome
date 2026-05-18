# Architecture

High-level reference. The product brief in [`BRIEF.md`](../BRIEF.md) is the source of truth — this doc captures the *current* state of the code.

## Components

```
apps/web        Next.js 14 (App Router) — UI, auth, calls apps/api
apps/api        FastAPI — render pipeline orchestration, product matching
packages/types  Shared TS types (domain + Supabase Database type)
supabase/       SQL migrations + local config
```

## Auth

- Supabase Auth handles sessions for both signed-in users and the OAuth flow.
- Next.js middleware (`apps/web/middleware.ts`) refreshes the session on every request and gates `/dashboard`, `/rooms`, `/renders`, `/settings`.
- `apps/web/lib/supabase/{client,server,middleware}.ts` wrap `@supabase/ssr` per the official Next.js App Router pattern.

## Data

See `supabase/migrations/20260518000000_init_schema.sql`.

- `users` mirrors `auth.users` via a trigger.
- `rooms`, `style_profiles`, `renders` are user-owned with RLS keyed on `auth.uid()`.
- `products` is a shared catalog with read access for authenticated users; the FastAPI backend uses the service-role key to write.
- `pgvector` HNSW index on `products.embedding` for similarity search (M2+).

## Render pipeline (target — to land in M1/M2)

The web client uploads a room photo → API enqueues a job → worker pulls the job, runs Depth Anything V2 + SAM 2 via fal.ai, calls Flux + ControlNet Depth for the restyle, runs Grounded SAM on the output, embeds each detected region with SigLIP, vector-searches `products` for matches, writes the result back to `renders`. The web client polls `/renders/{id}` until status is `succeeded`.

For M0 the API only exposes `/healthz`. The pipeline endpoints land in M1.

## Pinterest constraint (M3+)

Pinterest's TOS forbids storing pin data server-side. We fetch boards on demand, derive a style profile (descriptor + palette + materials + mood + embedding), persist only the derived signal in `style_profiles`, and never store pin images or URLs.
