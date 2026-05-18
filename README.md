# myhome

Mobile-first web app that restyles a real room photo into a photorealistic render in a chosen interior-design aesthetic, with every visible furniture item mapped to a real, in-stock product from an Australian retailer.

The product brand is **saltbush** (working). The repo name stays `myhome`.

- Product brief → [`BRIEF.md`](./BRIEF.md)
- Design system → [`docs/DESIGN-BRIEF.md`](./docs/DESIGN-BRIEF.md) (+ reference mockup at `docs/design-mockup.html`)
- Setup → [`docs/SETUP.md`](./docs/SETUP.md)
- Deploy → [`docs/DEPLOY.md`](./docs/DEPLOY.md)

## Status

**M0 — Skeleton + design foundation** (in progress).

## Repo layout

```
apps/
  web/                  Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
    app/design-system/  live component catalog — visit /design-system in dev
    components/saltbush/  Logo, Eyebrow, DisplayHeading, Pill, PaletteStrip, Hotspot, ItemCard
  api/                  FastAPI (Python 3.11+)
packages/
  types/                Shared TypeScript types (@myhome/types)
supabase/
  migrations/           SQL migrations (run via Supabase CLI)
docs/
  BRIEF.md, DESIGN-BRIEF.md, design-mockup.html, SETUP.md, DEPLOY.md, ARCHITECTURE.md
```

## Local setup (short version)

Prereqs: Node 20+, pnpm 9, Python 3.11+, optionally `flyctl` + Supabase CLI.

```bash
pnpm install

# Env (Supabase is optional in dev — landing page renders without it)
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

# Web — http://localhost:3000
pnpm --filter web dev

# API — http://localhost:8000
cd apps/api && python -m venv .venv && .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Full walk-through (Supabase project, OAuth providers, Sentry, PostHog) is in [`docs/SETUP.md`](./docs/SETUP.md).

## Design system

`pnpm --filter web dev` then open `http://localhost:3000/design-system` for the live component catalogue. Fonts (Fraunces · Geist · Geist Mono) load via `next/font/google`. Tokens and rationale live in [`docs/DESIGN-BRIEF.md`](./docs/DESIGN-BRIEF.md).

## Deploy

- **Frontend** → Vercel (project root: `apps/web`, region: `syd1`)
- **Backend** → Fly.io (`apps/api`, region: `syd`)

See [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## License

TBD.
