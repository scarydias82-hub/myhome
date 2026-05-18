# myHome API

FastAPI backend for the myHome render pipeline.

## Local dev

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate                       # Windows
# source .venv/bin/activate                  # macOS/Linux

pip install -r requirements.txt
pip install -e ".[dev]"                       # optional dev extras

cp .env.example .env                          # fill in Supabase keys
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for the OpenAPI UI.

## Endpoints (M0)

- `GET /` — name + links
- `GET /healthz` — liveness probe (used by Fly.io)

M1 will add `/rooms`, `/renders`, etc.

## Deploy (Fly.io)

```bash
flyctl launch --copy-config --no-deploy       # first time only — uses fly.toml
flyctl secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SENTRY_DSN=...
flyctl deploy
```
