# Deploy

## Frontend → Vercel

1. <https://vercel.com/new> → import the GitHub repo.
2. Set **Root Directory** to `apps/web`.
3. Framework preset: Next.js (auto-detected). Vercel will pick up `apps/web/vercel.json`.
4. Set Environment Variables (Settings → Environment Variables). Copy from `apps/web/.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — Vercel keeps it private)
   - `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
   - `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
   - `NEXT_PUBLIC_API_URL` = your Fly URL (e.g. `https://myhome-api.fly.dev`)
5. Deploy. Add the production URL to Supabase Auth → URL Configuration → Site URL + Redirect URLs:
   - Site URL: `https://<your-vercel-domain>`
   - Add `https://<your-vercel-domain>/auth/callback`

## Backend → Fly.io

```bash
cd apps/api

# First time: create the Fly app (uses fly.toml). --no-deploy so we can set secrets first.
flyctl launch --copy-config --no-deploy --region syd

# Set secrets
flyctl secrets set \
  SUPABASE_URL=... \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  SENTRY_DSN=... \
  POSTHOG_API_KEY=... \
  CORS_ORIGINS=https://<your-vercel-domain>,http://localhost:3000

# Deploy
flyctl deploy
```

Verify: `curl https://<your-fly-app>.fly.dev/healthz` returns `{"status":"ok",...}`.

## After deploy

1. Update `NEXT_PUBLIC_API_URL` in Vercel to the Fly URL → redeploy frontend.
2. Update `CORS_ORIGINS` in Fly secrets to include the Vercel domain → redeploy backend.
3. Sign up + sign in once on the live site to confirm the full loop works.

## Rollback

- Vercel: Deployments tab → ⋯ menu → "Promote to Production" on the prior green deploy.
- Fly: `flyctl releases` → `flyctl releases revert <version>`.
