# Setup

Step-by-step for getting myHome running locally from a clean machine. M0 only — M1+ adds fal.ai, Pinterest, and Commission Factory.

## 1. Prerequisites

- Node 20+ and pnpm 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Python 3.11+
- Docker Desktop (optional — only needed to run the API container locally)
- Supabase CLI (`scoop install supabase` on Windows, `brew install supabase/tap/supabase` on macOS)
- `flyctl` for backend deploys

## 2. Clone & install

```bash
git clone https://github.com/scarydias82-hub/myhome.git
cd myhome
pnpm install
```

## 3. Supabase

1. Create a project at <https://supabase.com/dashboard>. Pick the Sydney region.
2. Project Settings → API → copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, **never** ship to client)
3. Apply the schema:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push
   ```
   Or paste `supabase/migrations/20260518000000_init_schema.sql` into the SQL editor.
4. Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (and your prod URL once you have one)
   - Additional Redirect URLs: `http://localhost:3000/auth/callback`, `https://<your-prod-host>/auth/callback`
5. (Optional now, required before launch) Authentication → Providers → Google. Create OAuth credentials in Google Cloud Console, set the redirect URL to `https://<project-ref>.supabase.co/auth/v1/callback`.

## 4. Env files

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

Fill in the Supabase values you copied above. Sentry, PostHog, fal.ai, Hugging Face can stay blank for M0 — the code is defensive about missing keys.

## 5. Run web

```bash
pnpm --filter web dev
# http://localhost:3000
```

Smoke test:
- `/` loads the landing page
- `/signup` creates an account (check your email for confirmation)
- `/login` signs you in
- `/dashboard` is reachable when signed in, redirects to `/login` otherwise

## 6. Run API

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate                # Windows PowerShell
# source .venv/bin/activate           # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Smoke test:
- `GET http://localhost:8000/healthz` → `{"status":"ok",...}`
- `GET http://localhost:8000/docs` → Swagger UI

## 7. Sentry (optional for M0)

1. Create a Sentry org + two projects: `myhome-web` (platform: Next.js) and `myhome-api` (platform: FastAPI).
2. Copy the DSN for each into `apps/web/.env.local` (`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`) and `apps/api/.env` (`SENTRY_DSN`).
3. For source map upload at build time, create a Sentry auth token with `project:releases` scope and set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel.

## 8. PostHog (optional for M0)

1. Create a project at <https://app.posthog.com>.
2. Copy the Project API Key into `NEXT_PUBLIC_POSTHOG_KEY` (and `POSTHOG_API_KEY` on the API side).
3. Default host is `https://app.posthog.com` — leave the host variable as-is unless you're EU.

## 9. Verify

Run both servers, sign up a test user, and confirm:
- A row appears in `public.users` (Supabase Studio → Table editor)
- `/dashboard` shows your email
- Sign out works (POST to `/auth/signout`)
