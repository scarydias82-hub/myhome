# myHome

Mobile-first web app that restyles a real room photo into a photorealistic render in a chosen interior-design aesthetic, with every visible furniture item mapped to a real, in-stock product from an Australian retailer.

See [`BRIEF.md`](./BRIEF.md) for the full product brief.

## Status

**M0 — Skeleton** (in progress).

## Repo layout

```
apps/
  web/         Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
  api/         FastAPI (Python 3.11+)
packages/
  types/       Shared TypeScript types
supabase/
  migrations/  SQL migrations (run via Supabase CLI)
```

## Local setup

Prerequisites: Node 20+, pnpm, Python 3.11+, `flyctl` (deploy), Supabase CLI (DB), a Supabase project.

```bash
# 1. Install JS deps (uses pnpm workspaces)
pnpm install

# 2. Configure env
cp .env.example .env.local                 # root (shared)
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

# 3. Apply Supabase schema
supabase link --project-ref <your-ref>
supabase db push

# 4. Run dev servers (in two terminals)
pnpm --filter web dev                      # http://localhost:3000
cd apps/api && uv run uvicorn main:app --reload  # http://localhost:8000
```

See [`docs/SETUP.md`](./docs/SETUP.md) for the full external-account walkthrough (Supabase, Vercel, Fly.io, fal.ai, Pinterest, Sentry, PostHog, Commission Factory).

## Deploy

- **Frontend** → Vercel (project root: `apps/web`)
- **Backend** → Fly.io (`apps/api`, region `syd`)

See [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## License

TBD.
