# myMaison — overview

A single source of truth for the **business**, the **system**, the **product
today**, the **roadmap**, and the **how-to** for operating it with Claude Code.

Last verified: 2026-05-19. This doc supersedes `docs/ARCHITECTURE.md`,
`docs/SETUP.md`, and `docs/DEPLOY.md` (those were written for the M0
FastAPI/Fly era and are kept only for historical reference — re-read
this doc instead).

---

## 1. The proposition

> **From inspiration to a fully shopped room — in minutes.**

myMaison is the nexus between four things people currently navigate alone:

1. **Your inspiration** (Pinterest board, a magazine tear, a vague mood).
2. **Your actual room** (phone photo, real dimensions, real light).
3. **The Australian retailer catalogue** (Coco Republic, Poliform, GlobeWest
   today; Freedom + Bunnings on the way).
4. **A senior-designer-grade AI** (Claude reading the room + curated 2026
   palettes + AU design knowledge corpus).

You get back a photoreal restyle of *your* room, every visible piece mapped
to a real product you can buy today, with prices, dimensions and a buy link.

There are three audiences:

| Audience       | What they get                                                    |
|----------------|------------------------------------------------------------------|
| Consumers      | A photo → a fully shopped restyle in ~40 minutes. Free to start. |
| Design studios | Client-facing tooling: clients CRUD, PDF proposals, billing.     |
| Retailers      | Shop-ready traffic — customers who've seen the piece in-room.    |

---

## 2. Business model

### 2.1 Revenue streams

| Stream                         | From          | Status                | Notes                                                              |
|--------------------------------|---------------|-----------------------|--------------------------------------------------------------------|
| **Affiliate commissions**      | Consumers     | Live                  | Every buy link is affiliate-tagged. ACCC-compliant disclosure on the render page + signup. |
| **Studio subscription**        | Design studios| Planned (#70)         | Monthly plan unlocks clients CRUD, multiple projects, PDF proposals, branded exports. |
| **Retailer partnerships**      | Retailers     | Pipeline              | Two flavours: SKU placement priority, and brief-routing (#53) where a user's brief is emailed to a curated retailer shortlist. |
| **Paint / finishes API**       | Bunnings et al| Planned (#63)         | Wall paint as a first-class layer in the render, drives Bunnings affiliate revenue. |
| **Sale notifications**         | Retailers     | Planned (#52)         | Retailer-paid push when a watched SKU goes on sale. |

### 2.2 Pricing model (target)

- **Individual — free.** Three renders to start, full catalogue, full
  designer reads, virtual staging. Free forever for personal use. Affiliate
  commissions cover the unit economics.
- **Design studio — paid plan.** Monthly. Per-seat or per-active-client
  bracket. Unlocks the studio tooling stack (#66 onward).

### 2.3 Unit economics — back-of-envelope

| Cost                        | Per render | Notes                                                  |
|-----------------------------|-----------|--------------------------------------------------------|
| Claude vision analysis      | ~$0.003   | Haiku, one room photo, one structured-JSON return.     |
| Claude designer read        | ~$0.015   | Sonnet, system prompt + RAG chunks + structured output.|
| Flux canny img2img          | ~$0.03    | fal.ai, one 1024px restyle pass.                       |
| Florence-2 detection (×2)   | ~$0.005   | Two passes (default + caption grounding) for density.  |
| Claude validation + rank    | ~$0.01    | Haiku on cropped detections + ranker.                  |
| **Total before staging**    | **~$0.06**| Per completed render that lands on the picking list.   |
| Flux Pro Fill (per stage)   | ~$0.04    | Single product. Multi-product staging packs N → 1 call.|

A $30 sofa affiliate referral covers ~500 renders. Margins are healthy as
long as the catalogue conversion rate stays above ~0.2%.

### 2.4 Compliance — non-negotiable

- **ACCC affiliate disclosure** — every product card and the signup page
  state that buy links may be affiliate-tagged.
- **Pinterest TOS** — we *never* persist pin images or URLs. We derive a
  per-board style profile (descriptor + palette + materials + mood) and
  persist only that signal. (Phase 2 OAuth, #55, will land this properly.)
- **Privacy** — room photos are stored in a private Supabase bucket, served
  via signed URLs. RLS is on for every user-scoped table.
- **No secrets in the client.** `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`,
  `ANTHROPIC_API_KEY` are server-only env vars.

---

## 3. System architecture

### 3.1 The pieces

```
                       ┌──────────────────────┐
                       │   GitHub (main)      │
                       │  scarydias82-hub/    │
                       │     myhome           │
                       └──────────┬───────────┘
                                  │ auto-deploy
                                  ▼
                       ┌──────────────────────┐
                       │     Vercel (syd1)    │
                       │  apps/web · Next 16  │
                       └──────────┬───────────┘
                                  │
       ┌──────────────────────────┼───────────────────────────┐
       ▼                          ▼                           ▼
 ┌───────────┐            ┌──────────────┐            ┌──────────────┐
 │ Supabase  │            │   fal.ai     │            │  Anthropic   │
 │ (Sydney)  │            │  (Flux +     │            │  (Claude     │
 │ Postgres  │            │ Florence-2)  │            │  Haiku/Son.) │
 │ + Storage │            └──────────────┘            └──────────────┘
 │ + Auth    │
 │ + pgvector│            ┌──────────────┐
 └───────────┘            │ apps/scraper │  ← run locally; writes to
                          │ (pnpm node)  │    Supabase via service role
                          └──────────────┘
```

### 3.2 Each component — what + why

| Component                     | Path / vendor                          | Purpose                                                                                                       |
|-------------------------------|----------------------------------------|---------------------------------------------------------------------------------------------------------------|
| **Web app**                   | `apps/web` (Next.js 16, App Router)    | Every user-facing surface. Server Components for data fetches, client islands for interactivity. Single deployment target. |
| **API routes**                | `apps/web/app/api/**`                  | All backend logic lives co-located with the web app — `/api/render`, `/api/stage`, `/api/stage-multi`, `/api/analyse-room`, `/api/projects/[id]/shortlist`, etc. Edge-aware, async-cookie-aware. |
| **Auth + DB + Storage**       | Supabase (Sydney)                      | Postgres for relational data, Storage for room/render/staged image buckets, Auth for sessions. RLS on every user-scoped table. `pgvector` for the design-knowledge corpus. |
| **Render generation**         | fal.ai                                 | `flux-control-lora-canny/image-to-image` for the restyle (strength 0.70, canny conditioning preserves architecture). `flux-pro/v1/fill` for virtual staging. Async submit + poll pattern to clear Vercel's 60s function cap. |
| **Object detection**          | fal.ai (Florence-2)                    | Two parallel passes per render: default object-detection + caption-to-phrase-grounding with a curated furniture noun list. Results merged for picking-list density. |
| **Vision validation + rank**  | Anthropic Claude Haiku 4.5             | Crops each detection and asks Claude to classify (drops anything it reads as architecture, walls, doorways). Then ranks the catalogue against each detection by vision. Replaced an earlier CLIP-based ranker that wouldn't deploy reliably on Vercel. |
| **Designer LLM**              | Anthropic Claude Sonnet 4.6            | Reads the room analysis, the chosen palette, the matched products, and 5–8 RAG chunks from the design-knowledge corpus. Returns the editorial "designer read" shown on the render page. |
| **Room vision analysis**      | Anthropic Claude Haiku 4.5             | One-shot structured JSON from the uploaded room photo: dimensions estimate, light direction, existing materials, architecture features. Cached on `rooms.analysis` so we never re-pay for the same upload. |
| **Catalogue scrapers**        | `apps/scraper`                         | Standalone pnpm app. Coco Republic (BigCommerce sitemap), Poliform (Shopify JSON), GlobeWest (Magento + Playwright). Writes to `products` via service role. ~236 SKUs today. |
| **Trend generator**           | `apps/scraper/scripts/generate-trends.js` | Cron-run script that produces a Flux trend card per (palette × room type) and writes to `trend_cards`. Shown on the dashboard. |
| **Design knowledge RAG**      | `apps/scraper/data/design-knowledge-seed.json` → `design_knowledge` + CLIP-text embeddings | Curated 25-chunk AU corpus (Dulux 2026, S-W, Pantone, AIDA, Vogue Living AU, House & Garden, climate/building-stock notes). Retrieved via `match_design_knowledge` RPC. |
| **Hosting**                   | Vercel (region `syd1`)                 | Auto-deploy from `main`. Function timeout 60s — render and stage are async (queue submit + poll) to live within it. |

### 3.3 Key tables

| Table              | Owns                                                                 |
|--------------------|----------------------------------------------------------------------|
| `users`            | Mirrors `auth.users` via trigger. Profile fields go here.            |
| `projects`         | Top-level grouping. Status: `in_progress` → `in_review` → `completed`. |
| `rooms`            | Uploaded room photos + `analysis` JSONB (Claude's room read).        |
| `style_profiles`   | Descriptor + palette + materials + mood (per render, per board).     |
| `renders`          | One row per render attempt. Holds `fal_request_id`, `picking_list`, `cost_estimate_aud`, `status`, `output_url`. |
| `staged_images`    | One row per virtual-staging call. Single or multi-product.           |
| `products`         | Shared catalogue. Read for all authed users; service role writes.    |
| `shortlist_items`  | Per-project picks promoted from a render or a staged image.          |
| `trend_cards`      | Pre-rendered (palette × room) trend imagery for the dashboard.       |
| `design_knowledge` | Curated AU design corpus + CLIP-text embeddings for RAG.             |

### 3.4 Storage buckets

- `rooms` — original user-uploaded photos. Private. Signed URLs only.
- `renders` — output of the canny img2img pass. Private. Signed URLs only.
- `staged_images` — output of Flux Pro Fill staging. Private. Signed URLs only.

### 3.5 Why these choices (the boring but load-bearing decisions)

- **Canny ControlNet, not depth.** Depth Anything blew out room
  geometry. Canny edges + img2img at strength 0.70 keeps walls, windows,
  doors recognisable and only restyles what should change.
- **Claude vision matching, not CLIP.** CLIP via HuggingFace Inference API
  kept returning 404s on Vercel; local `@huggingface/transformers` couldn't
  load ONNX on Vercel's bundler. Claude vision both ranks better and
  returns a reasoning trace we can show.
- **Async render + polling.** Vercel Hobby caps function duration at 60s;
  a Flux render is ~25–60s, plus detection plus matching. So `/api/render`
  submits to fal's queue and returns immediately; `/api/renders/[id]/status`
  polls, finalises (download → storage → picking list) once fal completes.
- **Client-side image resize.** Vercel silently rejects request bodies
  above 4.5MB. Phone photos are routinely 6–12MB. We downscale to ~1600px
  / ~3.5MB in the browser before upload.
- **Multi-product staging in one Flux call.** Saves ~75% of staging
  credits by packing N selected items into one mask + position-hinted
  prompt. See `apps/web/lib/staging.ts → stageMultipleProducts`.
- **Detection validator.** Florence-2 occasionally tags a doorway as
  "rug" or a bed as "sofa". A Claude Haiku pass classifies each crop and
  drops anything that reads as architecture or noise.

---

## 4. How the application currently works

### 4.1 The consumer happy path

```
Signup or sign in
   │
   ▼
Dashboard ── trends, projects, AR catalogue ── New render
   │
   ▼
Upload room photo (HEIC ok; resized client-side to ~1600px)
   │
   ▼
[ Claude Haiku reads the room ]   ── rooms.analysis cached
   │
   ▼
Confirm read · pick palette (10 curated 2026 directions)
              · pick style (8 curated AU aesthetics)
              · pick up to 4 hero products
   │
   ▼
Submit → /api/render submits to fal queue, returns immediately
   │
   ▼
/renders/[id] polls /api/renders/[id]/status
   │
   ▼
[ Flux canny img2img ]                ~25–60s
   │
   ▼
[ Florence-2 detection × 2 passes ]
   │
   ▼
[ Claude Haiku validation ]           drop architecture, relabel
   │
   ▼
[ Claude Haiku ranks catalogue ]
   │
   ▼
Picking list rendered                 ──> /renders/[id] live
   │
   ├── Stage one product (Flux Pro Fill, mask = bbox)
   ├── Stage several products together (one Flux Pro Fill, multi-region mask)
   ├── Add render or staged image to project shortlist
   │
   ▼
/projects/[id] · status flips in_progress → in_review on first shortlist
   │
   ▼
Mark complete → status completed (locked final selection, re-open available)
```

### 4.2 The pipeline, file by file

| Step                          | Code                                                       |
|-------------------------------|------------------------------------------------------------|
| Upload form                   | `apps/web/components/rooms/upload-form.tsx`                |
| HEIC → JPEG conversion        | client-side via `heic-to` / `heic2any`                     |
| Client resize                 | `resizeForUpload` in same file                             |
| Room vision analysis          | `apps/web/lib/vision.ts` → `analyseRoom`                   |
| Analyse endpoint              | `apps/web/app/api/analyse-room/route.ts`                   |
| Palettes                      | `apps/web/lib/palettes.ts` + `apps/web/lib/palettes.json`  |
| Styles + prompt builder       | `apps/web/lib/styles.ts` → `buildPrompt`                   |
| Featured products             | `apps/web/app/api/featured-products/route.ts`              |
| Render submit (async)         | `apps/web/app/api/render/route.ts`                         |
| fal queue client              | `apps/web/lib/fal.ts` → `submitDepthRender`                |
| Render status + finalise      | `apps/web/app/api/renders/[id]/status/route.ts`            |
| Detection                     | `apps/web/lib/detection.ts`                                |
| Matching (validate + rank)    | `apps/web/lib/matching.ts`                                 |
| Designer read                 | `apps/web/lib/designer.ts` + `lib/prompts/designer-system.md` |
| Knowledge RAG retrieval       | `apps/web/lib/knowledge.ts`                                |
| Render page                   | `apps/web/app/renders/[id]/page.tsx`                       |
| Picking list panel            | `apps/web/components/renders/picking-list-panel.tsx`       |
| Single staging                | `apps/web/lib/staging.ts` → `stageProduct`                 |
| Multi-product staging         | `apps/web/lib/staging.ts` → `stageMultipleProducts`        |
| Stage endpoints               | `apps/web/app/api/stage/route.ts`, `/api/stage-multi/route.ts` |
| Shortlist                     | `apps/web/app/api/projects/[id]/shortlist/route.ts`        |
| Project lifecycle             | `apps/web/app/projects/[id]/page.tsx`                      |

### 4.3 The dashboard

The editorial dashboard at `/dashboard` is built from small primitives in
`apps/web/components/dashboard/**`:

- **TopNav** — wordmark (`my` italic taupe + `Maison` roman espresso) + Beta chip.
- **HeroGreeting** — name + four quick-action cards.
- **PinterestSection** — placeholder card; OAuth flow is on the roadmap (#55).
- **ProjectsSection** — current projects grouped by status.
- **TrendsSection** — `trend_cards` for (palette × room) — only renders if rows exist.
- **ARSection** — catalogue cards with compat scoring (compat scoring is
  placeholder today; #56 lands the real version).
- **NexusCTA** — dark editorial section linking to `/rooms/new`.

### 4.4 The brand system

- **Wordmark.** `my` italic taupe + `Maison` roman espresso. Always paired.
- **Type.** Playfair Display (display), DM Sans (body), DM Mono (metadata
  + caps). Loaded via `next/font/google` in `apps/web/app/layout.tsx`.
- **Palette.** `editorial-cream`, `editorial-surface`, `editorial-ink`,
  `editorial-taupe`, `editorial-cognac`, `editorial-border`,
  `editorial-borderStrong`. See `apps/web/tailwind.config.ts`.
- **Copy.** Sentence case, never Title Case. Em-dashes welcome. The
  designer read can italicise inside the copy with `<em>`.

The older "Saltbush" kit (Fraunces / Geist / clay) still ships for legacy
internal surfaces, but the public chrome — landing, login, signup,
dashboard, projects, renders — is all editorial.

---

## 5. Roadmap (backlog)

Each item below is tracked in the in-session task list. Numbers are the
task IDs; reference them when briefing Claude Code.

### 5.1 Catalogue expansion
- **#63 — Bunnings paint + wall materials scraper.** Adds wall paint as a
  first-class render layer + Bunnings affiliate revenue.
- **#64 — Freedom Furniture scraper.** Mass-market complement to the
  luxury catalogue.

### 5.2 Design Studio mode
- **#66 — Account type: Individual vs Studio.** Splits the signup form
  and gates the studio-only routes.
- **#67 — Clients CRUD.** Per-studio clients, each with address, brief,
  rooms.
- **#68 — Google Street View avatar for clients.** Auto-fetch a Street
  View thumbnail by address as the client avatar.
- **#69 — PDF proposal generation.** myMaison-branded PDF with rendered
  rooms, picking list, cost rollup.
- **#70 — Subscription billing.** Stripe; per-seat or per-active-client
  plan.

### 5.3 Pricing + ops
- **#51 — Labour & install cost estimates.** Tradie + install lines on
  the cost rollup.
- **#52 — Retailer sale notifications.** Push when a watched SKU goes on sale.
- **#53 — Brief-to-retailer email flow.** Email a user's brief to a
  curated retailer shortlist.
- **#54 — User postcode + store routing.** Show in-stock-at-your-store
  data on product cards.

### 5.4 Inspiration intake (Pinterest)
- **#23, #24, #55 — Pinterest OAuth + board ingest.** Per TOS: derive a
  style profile, never persist pin images.
- **#25 — Inspiration gallery in project.**
- **#26, #27 — Industry curation flow + curation-rich render.**

### 5.5 Render fidelity
- **#73 — SKU fidelity via reference-image inpainting.** Flux Pro Fill
  takes prompt + mask but **no reference image** — that's why a marble
  coffee table can render as a plain wood one. Needs IP-Adapter,
  multi-image controlnet, or a model variant that accepts a conditioning
  image of the selected SKU.

### 5.6 AR / discovery
- **#56 — Real AR-card compat scores.** Today's score is a placeholder.
- **#57 — Persist "Add to project" from AR card.**

### 5.7 Done in the last sprint (for reference)
- Multi-product staging in one Flux call (#71)
- Claude vision validation pass on detections (#72)
- Public pages migrated to myMaison editorial brand (#74)
- Three-audience testimonials on landing (latest commit)

---

## 6. How to operate myMaison (with Claude Code)

This section is the runbook. It assumes you (the site owner) are working
through Claude Code in a terminal.

### 6.1 First-time setup

```bash
# clone
git clone https://github.com/scarydias82-hub/myhome.git
cd myhome

# install (pnpm 9, Node 20+)
pnpm install
```

Create `apps/web/.env.local` with these keys (production values live in
Vercel → Settings → Environment Variables, never check in):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server-only — never expose to client

ANTHROPIC_API_KEY=sk-ant-...
FAL_KEY=...
HF_TOKEN=...                    # optional, only if you re-enable CLIP

# (when Pinterest OAuth lands)
PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
```

Run dev:

```bash
pnpm --filter web dev
# http://localhost:3000
```

### 6.2 Briefing Claude Code well — the patterns that worked

Claude Code is the operating layer. The way you brief it determines the
quality of the work. Three patterns to copy:

**Pattern A — fix a specific thing.** Lead with the symptom, the file,
and the constraint.

> "On `/renders/[id]`, the picking list panel shows a 'Stage with…'
> toggle on every card but the multi-select state isn't sticky across
> scroll. Fix it in `apps/web/components/renders/picking-list-panel.tsx`.
> Don't change the modal."

**Pattern B — ship a feature end-to-end.** Describe the user-visible
behaviour first; let Claude pick the file layout.

> "I want a 'Mark complete' button on `/projects/[id]` when status is
> `in_review`. It flips status to `completed`. The page should then show
> the final selection as a locked gallery with a 'Re-open' control. Use
> the editorial brand kit."

**Pattern C — research before code.** Use this when you don't know what
to ask for yet.

> "Audit our render pipeline for places we're paying for the same work
> twice. Look at `apps/web/app/api/render/route.ts`, the status route,
> and `lib/matching.ts`. Don't fix anything — just report."

A few rules of thumb:

- **Be specific about which files** when you know them. It saves the
  agent searching.
- **Say "don't touch X"** when you have an in-flight change.
- **Ask for typecheck + lint** when shipping anything substantial:
  `pnpm --filter web tsc --noEmit && pnpm --filter web lint`.
- **Commit + push in the same turn** unless you want to review first.
  Claude will ask if it's not clear.
- **Never paste API keys in chat.** If you do, revoke and rotate
  immediately — keys live in `.env.local` and Vercel env vars, full stop.

### 6.3 Common operations

#### Add a new migration

```bash
# create a file in supabase/migrations/ with timestamp prefix
# e.g. 20260601000000_add_clients_table.sql

# apply to local
supabase db push

# apply to prod
# paste into Supabase Studio → SQL editor, or use the CLI with the
# linked project ref
```

#### Re-scrape the catalogue

```bash
cd apps/scraper
pnpm install
pnpm run scrape         # all three retailers
pnpm run scrape:coco    # one at a time
pnpm run ingest         # writes scraped data to products table
pnpm run embed          # generates CLIP image embeddings (optional)
```

Service-role Supabase key must be in `apps/scraper/.env`.

#### Regenerate trend cards

```bash
cd apps/scraper
pnpm run trends         # iterates palette × room, calls Flux + Claude
```

Run weekly (or whenever palette/style content changes substantially).
Costs ~$1.50–$3 per full pass.

#### Embed the design-knowledge corpus

```bash
cd apps/scraper
pnpm run embed:knowledge
```

Run after editing `data/design-knowledge-seed.json`.

### 6.4 Deploying

Vercel auto-deploys every push to `main`. The deployment chain:

```
git push origin main  →  GitHub  →  Vercel webhook  →  build  →  promote
```

If a deploy hangs on an old commit:

```bash
git commit --allow-empty -m "chore: nudge deploy"
git push origin main
```

Vercel root directory must stay `apps/web`. Framework auto-detects from
`apps/web/vercel.json`.

Rollback: Vercel dashboard → Deployments → ⋯ on the prior green deploy →
"Promote to Production."

### 6.5 Where to look when something breaks

| Symptom                                  | Look here                                                       |
|------------------------------------------|-----------------------------------------------------------------|
| Render starts but never finishes         | fal dashboard → queue → check the request ID stored on `renders.fal_request_id`. Vercel function logs for the `/api/renders/[id]/status` route. |
| Render returns garbage / drifting walls  | `lib/styles.ts → buildPrompt`. Confirm strength is 0.70, canny is on, prompt is grounded in vision facts. |
| Picking list shows architecture          | `lib/matching.ts → validateBoxesWithClaude`. Confirm the validator pass is running and Haiku key is live. |
| "Bucket not found" on upload             | Supabase Storage → confirm the `rooms`, `renders`, `staged_images` buckets exist and are private. |
| Auth redirects break                     | Supabase → Auth → URL Configuration → confirm Vercel domain is in Site URL + Additional Redirect URLs. |
| Vercel says "No Next.js version found"   | Settings → General → Root Directory must be `apps/web`. |
| Upload fails silently on phone           | Look for the 4.5MB body cap — the client-side resize in `upload-form.tsx` should be downscaling, but a truly massive HEIC can sneak through. |
| Designer read is empty                   | `lib/designer.ts` — confirm `ANTHROPIC_API_KEY` is set and the system prompt loads. |
| Trend cards section missing              | `trend_cards` table is empty. Run the trend generator. |

### 6.6 Cost levers

| Lever                                   | Effect                                                  |
|-----------------------------------------|---------------------------------------------------------|
| Cache `rooms.analysis`                  | Done. We never re-pay vision for the same photo.        |
| Multi-product staging                   | Done. N items → 1 Flux Pro Fill call.                   |
| Lower Florence-2 to one pass            | Cheaper, but density drops. Tune per cohort.            |
| Switch Sonnet → Haiku for designer read | Cheaper. Quality drops noticeably; only do for free tier if margins tighten. |
| Pre-render trend cards weekly           | Spreads cost; users see fresh imagery at marginal cost. |

### 6.7 API keys + accounts to know about

| Service     | Account / dashboard URL                          | What to monitor                                |
|-------------|--------------------------------------------------|------------------------------------------------|
| Vercel      | <https://vercel.com/dashboard>                   | Deploys, function logs, env vars, region.      |
| Supabase    | <https://supabase.com/dashboard>                 | Tables, RLS, storage buckets, auth users.      |
| Anthropic   | <https://console.anthropic.com>                  | Usage, key rotation. Haiku + Sonnet both used. |
| fal.ai      | <https://fal.ai/dashboard>                       | Credit balance, queue, model versions.         |
| GitHub      | <https://github.com/scarydias82-hub/myhome>      | Repo, Actions if added later, secrets.         |
| Hugging Face| <https://huggingface.co>                         | Optional. Only matters if CLIP is re-enabled.  |

Rotate any key that's ever been pasted into a chat, slide, screenshot,
or email. There are no exceptions to that rule.

### 6.8 Working with the agent on a new feature — end-to-end example

> **You:** "Add labour & install cost estimates to the project review
> page. For each completed render, take the picking list and add a 10%
> install line on furniture + a flat $400 styling line. Show it under the
> existing cost rollup with a small caveat. Editorial brand."
>
> **Claude:** reads `apps/web/app/projects/[id]/page.tsx` and the cost
> rollup component, plans the change, edits the component, runs
> `pnpm tsc --noEmit`, commits as
> `feat(web): add labour & install line items to project rollup`,
> pushes, and reports back the commit SHA + Vercel deploy URL.
>
> **You:** check `/projects/[id]` once Vercel finishes. If it's wrong,
> brief the next change against the live page.

That's the loop. Brief → ship → review → brief again.

---

## 7. Appendix

### 7.1 Repo layout

```
myhome/
├── apps/
│   ├── web/              ← Next.js 16 app (deployed to Vercel)
│   │   ├── app/          ← App Router routes
│   │   │   ├── api/      ← Server routes (render, stage, projects, ...)
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   ├── renders/
│   │   │   ├── rooms/
│   │   │   ├── login/    ← editorial brand
│   │   │   ├── signup/   ← editorial brand
│   │   │   └── page.tsx  ← landing, editorial brand
│   │   ├── components/   ← shared UI (dashboard/, renders/, projects/, saltbush/, ui/)
│   │   ├── lib/          ← server-side helpers (fal, vision, designer, matching, staging)
│   │   └── tailwind.config.ts
│   └── scraper/          ← standalone pnpm app for catalogue + trends
│       ├── scrapers/     ← cocoRepublic.js, poliform.js, globeWest.js
│       ├── scripts/      ← ingest, embed, embed-knowledge, generate-trends
│       └── data/         ← design-knowledge-seed.json
├── supabase/migrations/  ← timestamped SQL migrations
├── docs/                 ← this folder
│   ├── OVERVIEW.md       ← you are here
│   ├── DESIGN-BRIEF.md   ← editorial brand spec (still current)
│   ├── ARCHITECTURE.md   ← historical (M0 FastAPI era)
│   ├── DEPLOY.md         ← historical
│   └── SETUP.md          ← historical
├── BRIEF.md              ← original product brief (M0–M2)
└── README.md
```

### 7.2 Where the older docs are still useful

- **`docs/DESIGN-BRIEF.md`** — the editorial brand spec. Still current.
  Refer to it when adding new surfaces.
- **`docs/ARCHITECTURE.md`** — historical. Pre-dates the move to a
  Next-only stack. Read for context, don't follow its setup.
- **`docs/SETUP.md` / `docs/DEPLOY.md`** — pre-Vercel-only era. Read
  Section 6 of this doc instead.
- **`BRIEF.md`** — original M0–M2 product brief. We're well past M2 but
  the proposition + design principles still apply.

### 7.3 Naming conventions

- Branches: short kebab — `fix/picking-list-mobile`, `feat/clients-crud`.
- Commits: Conventional Commits — `feat(web): ...`, `fix(web): ...`,
  `chore(web): ...`. Scope is `web` for the app, `scraper` for catalogue
  work, `docs` for documentation.
- API routes: kebab — `/api/analyse-room`, `/api/stage-multi`.
- React components: kebab files, PascalCase exports.
- Tables: snake — `shortlist_items`, `trend_cards`.

### 7.4 Glossary

- **Nexus** — myMaison's word for the convergence point between
  inspiration, room, catalogue, and AI designer.
- **Picking list** — the per-render list of matched products with bbox,
  price, dimensions, buy link.
- **Staging** — placing one or more catalogue products into the user's
  original room photo via Flux Pro Fill.
- **Shortlist** — a project-scoped collection of renders + staged images
  the user has promoted toward a final selection.
- **Designer read** — Claude Sonnet's editorial commentary on a render,
  grounded in palette, materials, and AU design knowledge.
- **Hero product** — a user-selected catalogue piece that anchors the
  render prompt.
