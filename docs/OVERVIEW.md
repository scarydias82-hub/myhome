# myMaison — overview

The **living source of truth** for the business, the strategy, the system,
the product today, the roadmap, and the how-to for operating it with Claude
Code.

**Last verified:** 2026-05-19 · most recent material commit: `fef1b0c` (will
be bumped on the commit that lands this revision).

> **Living-doc protocol.** Every commit that materially changes the
> product, the system, or the business updates the relevant section of this
> doc *in the same commit*, prepends an entry to the Changelog below, and
> bumps the *Last verified* date. Claude Code is briefed on this protocol
> via [`CLAUDE.md`](../CLAUDE.md) at the repo root and will action it
> without being asked — if a session forgets, remind it.

This doc supersedes `docs/ARCHITECTURE.md`, `docs/SETUP.md`, and
`docs/DEPLOY.md` (kept for historical reference only — read this instead).

---

## Changelog

Most recent first. One line per commit that materially changes the
product, the system, or the business. Cross-reference SHAs with
`git log --oneline` when you need precision.

- `2026-05-19` — Render aggressiveness: Stage 1 shipped (task #83). Flux
  strength 0.70 → 0.82, guidance 3.5 → 4.0, canny lock unchanged at 0.85.
  `buildPrompt` rewritten to drive palette-applied walls, palette-
  appropriate flooring, curtains/sheers on every window, statement
  lighting, wall art at eye-level. Detection expanded to curtains /
  sheers / drapes / chandelier / sculpture / planter / wall art. Picking
  list density 8 → 15 items. Items with zero catalog matches are
  dropped (demand-signal logged) until the relevant scraper lands.
  Stages 2–5 memoed as tasks #78–#82.
- `2026-05-19` — Fixed §7.3 manual-provisioning SQL recipe. The
  previous draft referenced `auth.admin_create_user` which is a JS
  admin SDK method, not a SQL function. Replaced with the proper
  `insert into auth.users` recipe using `crypt()` + `gen_salt('bf')`.
- `2026-05-19` — Finished the editorial rebrand. Flipped the CSS
  variable values in globals.css so every legacy class (bg-paper,
  text-ink, text-clay, font-display) now renders the editorial palette
  / fonts. Logo no longer says "saltbush." — it now renders the
  myMaison wordmark with the Beta chip. `/projects/[id]`, `/renders/[id]`,
  `/rooms/new` and every other internal surface auto-rebrand without
  source changes. Task #77 closed.
- `2026-05-19` — Fixed landing testimonials melting into the cream
  background on mobile. Cards now ride a cognac left-bar with stronger
  border + shadow-card lift, so they survive without the desktop grid
  structure giving them anchor.
- `2026-05-19` — Memoed terms & conditions acceptance flow as roadmap
  §6.7 (task #76) — covers /legal/terms + /legal/privacy pages, an
  acceptance audit log, and the implicit-vs-explicit recommendation.
- `2026-05-19` — Living-doc protocol + `CLAUDE.md`. Added §3 Business
  strategy. Locked public sign-ups (closed beta — manual provisioning).
  Editorial hero canvas on landing page.
- `2026-05-19` · `cbc5f1c` — Initial OVERVIEW.md (business, system, runbook).
- `2026-05-19` · `1314c29` — Three-audience testimonials on landing.
- `2026-05-19` · `a7354da` — Public pages migrated to myMaison editorial brand.
- `2026-05-19` · `838947f` — Florence-2 detections validated by Claude Haiku.
- `2026-05-18` · `4dc8481` — Multi-product staging in a single fal call.
- `2026-05-18` · `d7fb5b4` — Mobile horizontal-scroll fix (global viewport lock).
- `2026-05-18` · `39e66d0` — Project lifecycle: Analysis → Review → Complete.
- `2026-05-18` · `29e457f` — myMaison rebrand + denser picking-list detection.
- `2026-05-18` · `ca1c215` — Editorial-luxury `/dashboard` redesign.
- Earlier commits captured in `BRIEF.md` milestone log.

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
| **Affiliate commissions**      | Consumers     | Live                  | Every buy link is affiliate-tagged. ACCC-compliant disclosure on the render page + sign-up. |
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

- **ACCC affiliate disclosure** — every product card and the sign-up page
  state that buy links may be affiliate-tagged.
- **Pinterest TOS** — we *never* persist pin images or URLs. We derive a
  per-board style profile (descriptor + palette + materials + mood) and
  persist only that signal. (Phase 2 OAuth, #55, will land this properly.)
- **Privacy** — room photos are stored in a private Supabase bucket, served
  via signed URLs. RLS is on for every user-scoped table.
- **No secrets in the client.** `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`,
  `ANTHROPIC_API_KEY` are server-only env vars.

### 2.5 Current status — closed beta

> **Public sign-ups are paused.** myMaison is in closed beta. The
> `/signup` page renders a "request access" state and the Supabase Auth
> dashboard has *Allow new users to sign up* disabled so the lock is
> server-enforced — nothing in code can bypass it. Existing accounts
> continue to work — they sign in at `/login` as normal. New accounts are
> provisioned manually by the owner (see §7.3).

To re-open public sign-ups later: Supabase → Authentication → Providers →
re-enable signup, then set `NEXT_PUBLIC_SIGNUPS_OPEN=true` in Vercel and
redeploy. The `/signup` page reverts to the live form automatically.

---

## 3. Business strategy

This section is the owner's playbook. It changes with the business —
update it as decisions are made.

### 3.1 Strategic position — what's defensible

AI models are commodities. Anyone can call Claude or Flux, and they will.
The editorial flair is copyable too. What's defensible — and where the
energy should go:

| Moat                              | Why it's hard to copy                                                                 |
|-----------------------------------|----------------------------------------------------------------------------------------|
| **AU catalogue depth**            | 500+ SKUs across paint, furniture, lighting, decor — each one is a partnership and a feed. A year+ of work. |
| **Design knowledge corpus**       | 25+ curated chunks of AU design wisdom grounded in climate, building stock, AU palette directions. Expanding to 200+. Editorial sweat equity. |
| **Brand and editorial voice**     | myMaison's tone, palette curation, designer reads. A magazine-level standard that compounds with every render. |
| **Retailer relationships**        | Each affiliate + featured partnership is a contract. Once stitched, hard to unstitch. |

Marketing pours into #1 + #3 + #4. Engineering pours into #1 + #2.

### 3.2 Go-to-market — phases

| Phase | What                                  | Who                                        | Goal                                              |
|-------|---------------------------------------|--------------------------------------------|---------------------------------------------------|
| 0     | **Closed beta (now)**                 | 20–50 hand-picked users across all 3 tiers | Real testimonials, conversion data, 3 named retailer partnerships |
| 1     | **Open beta for individuals**         | Free plan, public sign-up                  | 1,000 signups, 100 completed renders/month        |
| 2     | **Design Studio paid plan**           | Stripe billing, clients CRUD, PDF proposals| 20 paying studios in first 90 days                |
| 3     | **Retailer self-serve**               | Retailers manage their own SKU feeds       | 25 retailers self-serving + featured tier revenue |

### 3.3 Marketing tactics by audience

**Consumers**

- **Pinterest organic + paid** — the inspiration funnel. Users are already
  there. Pin every render to relevant boards (auto-pin via Pinterest API
  once OAuth lands, #55).
- **Instagram before/after carousels** — trend cards from `trend_cards`
  make natural reels. Three per week, cross-posted from Pinterest.
- **TikTok shop-the-room creators** — partner with 5–10 AU room-styling
  creators on a referral commission split.
- **SEO long-tail** — "best [style] sofa Australia under $X" hub-and-spoke
  pages built from the catalogue. Server-rendered, indexable.
- **Referral program** — every user gets a code. Both sides get +3 renders.
  Wire into the sign-up flow once it reopens.
- **PR angle** — "AI for the 80% of Australians who can't afford an
  interior designer." Pitch AU lifestyle and tech press.

**Design studios**

- **AIDA / DIA partnerships** — sponsor the IDEA Awards, INDE Awards, AIDA
  conference. Become the AI tool the AU design industry sanctions.
- **Free-for-life for the first 20 studios** in exchange for a public
  case study + one-pager testimonial.
- **Trade press** — Inside Out trade edition, ArchitectureAU, Indesign.
  Bylined articles from the founder on AI in interior design.
- **Direct outreach** — every AU Instagram studio with >5k followers gets a
  personalised 30-second Loom demo: *"you spend 8 hours on mood boards;
  here's 20 minutes."*
- **Showroom partnerships** — co-host events at Coco Republic / GlobeWest
  showrooms. Hands-on sessions, bring a room photo.

**Retailers** — see §3.5.

### 3.4 Content marketing engine

| Channel              | What                                                          | Cadence            |
|----------------------|---------------------------------------------------------------|--------------------|
| Pinterest            | Trend cards from `trend_cards`, one per palette × room        | Weekly auto-post   |
| Instagram            | Before/after carousels, trend reels                           | 3× a week          |
| `/journal` (blog)    | Top 10 renders → editorial posts with the designer read       | 2× a week          |
| LinkedIn             | Founder voice — AU design + AI angle, short posts             | 3× a week          |
| Newsletter           | "Restyles of the week" + one trend insight from the corpus    | Weekly             |
| `/press` (press kit) | Wordmark, founder bio, screenshots, embargo policy            | Always up to date  |

### 3.5 Retailer engagement playbook

**The pitch — one paragraph:**

> "We're myMaison, an Australian interior-design AI that renders a
> homeowner's actual room in their preferred aesthetic, then maps every
> visible piece to a real, buyable product. Pilot data suggests we send
> ~3× the conversion of a paid-referral channel because the customer has
> already seen the piece work in their room — and returns are lower for
> the same reason. We're stocked from Coco Republic, Poliform and
> GlobeWest today, with 200+ SKUs across furniture, lighting and decor.
> We'd like to add you next. Beta placement is free in exchange for a SKU
> feed and three months of conversion data. 15 minutes this week?"

**The first 10 to approach** (in addition to the three already live):

| Retailer                | Why                                                                  |
|-------------------------|----------------------------------------------------------------------|
| Freedom Furniture       | Mass-market complement to Coco Republic. AU's #1 furniture brand by reach. |
| Bunnings                | Paint + finishes — first non-furniture vertical. Massive affiliate revenue. |
| West Elm AU             | Millennial-luxe positioning. Catalogue API is mature.                |
| Domayne                 | Mid-luxe AU. Big online presence, strong AU brand.                   |
| Castlery                | Online-native, AU-active, fast logistics. Fits "shop the render today". |
| Sheridan                | Soft furnishings. Critical for bedrooms + linen styling.             |
| Aura Home               | Linen, textiles. Coastal / Hamptons styling.                         |
| Adairs                  | Homewares mass-market. Wide age range.                               |
| Provincial Home Living  | Heritage / French country — fills a stylistic gap.                   |
| Temple & Webster        | Aggregator. Potential upstream catalogue partnership.                |

**Onboarding kit** — what we need from a retailer:

- SKU feed (CSV / JSON / Shopify API / BigCommerce API — we adapt).
- Image rights for in-platform display (one-page rights letter).
- Affiliate-link format (Commission Factory, Awin, Impact, or direct partner ID).
- Brand-safety contact for ACCC disclosure questions.

**Partnership tiers:**

| Tier        | Revenue model                          | What they get                                                     |
|-------------|----------------------------------------|-------------------------------------------------------------------|
| Affiliate   | Affiliate commission only. No fee.     | Catalogue inclusion, organic match priority via Claude vision.    |
| Featured    | Quarterly fee + higher commission.     | Priority placement in renders + trend-card co-branding.           |
| Anchor      | Annual contract.                       | Co-marketing, custom palette curated together, dashboard module.  |

Beta retailers go in at the **Affiliate** tier with a "founding partner"
plaque on their footer in the dashboard.

**What NOT to over-promise:**

- Don't quote conversion rates we don't have yet. Be honest about
  beta-stage data.
- Don't promise specific SKU placement — Claude vision picks the best
  match by image, not by commercial agreement.
- Don't commit to volume; we don't control user demand.
- Don't guarantee zero returns. Lower than baseline, yes; zero, no.

**Holding the line on quality:**

- Reject retailers whose photography isn't on par with the brand. They
  drag the editorial standard down.
- Cap the catalogue at four retailers per stylistic niche (e.g. mid-luxe
  sofas) to avoid dilution.

### 3.6 The owner's checklist — things only you can decide

- **Funding.** Bootstrap on affiliate revenue, or raise? If raising:
  pre-seed at $1–1.5M AUD from AU design + AI angels? Decide before Phase 2.
- **Incorporation.** Register myMaison Pty Ltd with ASIC. ABN. GST
  registration is required once revenue > $75k annualised.
- **Trademark.** Register the wordmark and the name with IP Australia
  before any press push.
- **Domains.** Confirm `mymaison.com.au`, `.ai`, `.com`, `.au`
  registrations are with you and on auto-renew.
- **Legal docs (before commercial launch):**
  - Privacy policy (covers Pinterest derived-only signal, Supabase
    storage, affiliate disclosure, optional GDPR).
  - Terms of service (free vs paid tiers, IP ownership of renders,
    retailer affiliate flow).
  - Retailer partnership template (the three tiers above).
  - Design Studio subscription agreement.
- **Insurance.** Professional indemnity once paid traffic flows. Cyber
  insurance once retailer commissions and studio payments are live.
- **Banking.** Separate AU business account before retailer commissions
  start landing. Business credit card with auto-categorisation.
- **Tax.** Engage an AU accountant familiar with the R&D Tax Incentive
  (RDTI). The AI dev work qualifies; significant rebate available.
- **Hiring runway.** At what revenue or funding milestone does the second
  hire (full-stack engineer? designer? retailer-partnerships lead?)
  come in?

### 3.7 Beta-cohort priorities — next 90 days

| KPI                                                | Target |
|----------------------------------------------------|--------|
| Individual users (manually provisioned)            | 20     |
| Design studios trialling                            | 5      |
| Active retailer feeds                               | 5      |
| Renders completed                                   | 200    |
| Named on-the-record testimonials (one per tier)    | 3      |
| Affiliate conversion data points                    | 30+    |
| Press / industry mentions                           | 3      |

The cohort is the foundation of every future marketing claim. Spend on
making sure each user has a great first render — concierge-style if needed.

---

## 4. System architecture

### 4.1 The pieces

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

### 4.2 Each component — what + why

| Component                     | Path / vendor                          | Purpose                                                                                                       |
|-------------------------------|----------------------------------------|---------------------------------------------------------------------------------------------------------------|
| **Web app**                   | `apps/web` (Next.js 16, App Router)    | Every user-facing surface. Server Components for data fetches, client islands for interactivity. Single deployment target. |
| **API routes**                | `apps/web/app/api/**`                  | All backend logic co-located with the web app — `/api/render`, `/api/stage`, `/api/stage-multi`, `/api/analyse-room`, `/api/projects/[id]/shortlist`, etc. Edge-aware, async-cookie-aware. |
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

### 4.3 Key tables

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

### 4.4 Storage buckets

- `rooms` — original user-uploaded photos. Private. Signed URLs only.
- `renders` — output of the canny img2img pass. Private. Signed URLs only.
- `staged_images` — output of Flux Pro Fill staging. Private. Signed URLs only.

### 4.5 Why these choices (the boring but load-bearing decisions)

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

## 5. How the application currently works

### 5.1 The consumer happy path

```
Sign in (sign-ups are locked during closed beta — accounts manually provisioned)
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

### 5.2 The pipeline, file by file

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

### 5.3 The dashboard

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

### 5.4 The brand system

- **Wordmark.** `my` italic taupe + `Maison` roman espresso. Always paired.
- **Type.** Playfair Display (display), DM Sans (body), DM Mono (metadata
  + caps). Loaded via `next/font/google` in `apps/web/app/layout.tsx`.
- **Palette.** `editorial-cream`, `editorial-surface`, `editorial-ink`,
  `editorial-taupe`, `editorial-cognac`, `editorial-border`,
  `editorial-borderStrong`. See `apps/web/tailwind.config.ts`.
- **Copy.** Sentence case, never Title Case. Em-dashes welcome. The
  designer read can italicise inside the copy with `<em>`.

The legacy "Saltbush" kit no longer exists as a separate visual kit.
The CSS variables (`--paper`, `--ink`, `--clay`, `--font-display`, etc.)
were remapped in `app/globals.css` to the editorial palette and fonts,
so every legacy Tailwind class (`bg-paper`, `text-ink`, `text-clay`,
`font-display`) auto-renders editorial output. The `components/saltbush/`
file path is preserved only because every internal surface imports from
there — the path is historical, the visual is current.

---

## 6. Roadmap (backlog)

Each item below is tracked in the in-session task list. Numbers are the
task IDs; reference them when briefing Claude Code.

### 6.1 Catalogue expansion
- **#63 — Bunnings paint + wall materials scraper.** Adds wall paint as a
  first-class render layer + Bunnings affiliate revenue.
- **#64 — Freedom Furniture scraper.** Mass-market complement to the
  luxury catalogue.

### 6.2 Design Studio mode
- **#66 — Account type: Individual vs Studio.** Splits the sign-up form
  and gates the studio-only routes.
- **#67 — Clients CRUD.** Per-studio clients, each with address, brief,
  rooms.
- **#68 — Google Street View avatar for clients.** Auto-fetch a Street
  View thumbnail by address as the client avatar.
- **#69 — PDF proposal generation.** myMaison-branded PDF with rendered
  rooms, picking list, cost rollup.
- **#70 — Subscription billing.** Stripe; per-seat or per-active-client
  plan.

### 6.3 Pricing + ops
- **#51 — Labour & install cost estimates.** Tradie + install lines on
  the cost rollup.
- **#52 — Retailer sale notifications.** Push when a watched SKU goes on sale.
- **#53 — Brief-to-retailer email flow.** Email a user's brief to a
  curated retailer shortlist.
- **#54 — User postcode + store routing.** Show in-stock-at-your-store
  data on product cards.

### 6.4 Inspiration intake (Pinterest)
- **#23, #24, #55 — Pinterest OAuth + board ingest.** Per TOS: derive a
  style profile, never persist pin images.
- **#25 — Inspiration gallery in project.**
- **#26, #27 — Industry curation flow + curation-rich render.**

### 6.5 Render fidelity
- **#73 — SKU fidelity via reference-image inpainting.** Flux Pro Fill
  takes prompt + mask but **no reference image** — that's why a marble
  coffee table can render as a plain wood one. Needs IP-Adapter,
  multi-image controlnet, or a model variant that accepts a conditioning
  image of the selected SKU.

### 6.6 AR / discovery
- **#56 — Real AR-card compat scores.** Today's score is a placeholder.
- **#57 — Persist "Add to project" from AR card.**

### 6.6.5 Render aggressiveness (emotional-attachment programme)

Strategy: drive the user to emotional commitment to *their* room by
making the render more aggressive — wall paint, flooring swap, curtains,
statement lighting all on by default — and by surfacing more shoppable
items per render. The lift then funnels into warm leads to retailers.
Stage 1 is live; the rest is sequenced.

- **#83 — Stage 1: aggressive prompt + detection density. SHIPPED.**
  `buildPrompt` now applies the chosen palette across walls, flooring,
  curtains; Flux strength up to 0.82 (canny still locks geometry at
  0.85); detection picks up curtains, chandelier, sculpture, planter,
  wall art; picking list 8 → 15 items; zero-match items skip with
  demand-signal logging.
- **#78 — Stage 2: comparison render mode (subtle vs bold).** Render
  both modes on submit, let the user pick. Captures emotion preference
  as data. Only build this if Stage 1 turns out too aggressive for
  some cohorts; otherwise skip.
- **#79 — Stage 3a: Beacon Lighting scraper.** Highest-impact next
  scrape. Lighting is the second-most-detected item after furniture
  and we currently have only a handful of Lighting SKUs across the
  three live retailers.
- **#80 — Stage 3b: Spotlight + Adairs curtains/textiles.** Curtains
  is a brand-new category as of Stage 1 — empty catalog today.
- **#81 — Stage 3c: The Rug Establishment + Choices Flooring.** Rugs
  + hard flooring. Sandstone-2026 palette especially calls for oak +
  herringbone + travertine.
- **#82 — Stage 4: "Visualise this whole room" + emotional UX.**
  After the picking list lands, auto-stage the top match for every
  detected item into one composite Flux Pro Fill call. This is the
  emotional commitment moment.
- (Stage 5 = warm-lead retailer plumbing — covered by existing
  pending tasks #52 + #53.)

### 6.7 Legal & compliance
- **#76 — Terms & Conditions acceptance at sign-up.** Today the live
  sign-up form (when reopened) carries an *implicit*-acceptance footer
  ("by creating an account you agree to our terms and privacy notice")
  with links to `/legal/terms` and `/legal/privacy` — both pages don't
  yet exist. To do, in order:

  1. **Write the pages.** `/legal/terms` and `/legal/privacy`, editorial
     brand, sentence case. Cover: IP ownership of renders, ACCC affiliate
     disclosure, acceptable use (no scraping, no reselling), termination,
     data handling (Pinterest derived-only signal, room-photo retention,
     Supabase Sydney storage), limitation of liability, governing law
     (NSW Australia), beta-stage disclaimer. Get lawyer review before
     they go live — referenced from §3.6 owner's checklist.
  2. **Add an audit log.** Migration: `acceptance_log` table with
     `(user_id, terms_version, privacy_version, accepted_at,
     ip_address, user_agent)`. Service-role-only writes; RLS read for
     the owning user only.
  3. **Decide implicit vs explicit acceptance.**
     - *Implicit* (today's footer) is cheaper but weaker under
       Australian Consumer Law if a dispute lands. Suits low-risk
       surface touches.
     - *Explicit* (required checkbox before submit) is the safer bet.
       Required when sign-up unlocks paid features or sensitive data
       capture (Design Studio plan, Pinterest OAuth, client PII).
     - **Recommendation:** explicit on sign-up *and* on first paid
       action (Stripe billing init). Implicit elsewhere.
  4. **Version + re-prompt.** Add a `terms_version` and `privacy_version`
     constant in `apps/web/lib/legal.ts`. If either bumps, the next
     sign-in fires a modal that requires re-acceptance before the
     dashboard renders. Acceptance writes a fresh row to
     `acceptance_log`.
  5. **Closed-beta interim.** Even while sign-up is paused, the manually
     provisioned users in the cohort should still hit a one-time
     acceptance modal on first sign-in once the pages exist — the audit
     log starts from day one, no exceptions.

### 6.8 Recently shipped (for reference)
- Editorial rebrand across all internal surfaces (#77) — `/projects/[id]`,
  `/renders/[id]`, `/rooms/new`, `/catalogue`, `/privacy`, etc. now
  render in the editorial brand via globals.css CSS-variable flip plus
  font aliasing. The `<Logo>` component was rewritten to render the
  myMaison wordmark in place of the old "saltbush." text.
- Testimonials mobile fix — cognac left-bar + shadow lift.
- Closed-beta lock on public sign-ups (manual provisioning).
- Living-doc protocol + `CLAUDE.md`.
- Three-audience testimonials on landing.
- Public pages migrated to myMaison editorial brand (#74).
- Florence-2 detections validated by Claude Haiku (#72).
- Multi-product staging in one Flux call (#71).
- Project lifecycle: Analysis → Review → Complete (#50).

---

## 7. How to operate myMaison (with Claude Code)

This section is the runbook. It assumes the site owner is working through
Claude Code in a terminal.

### 7.1 First-time setup

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

# Sign-ups: 'false' (default) keeps /signup in closed-beta state.
# Flip to 'true' AND re-enable signups in Supabase to reopen.
NEXT_PUBLIC_SIGNUPS_OPEN=false

# (when Pinterest OAuth lands)
PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
```

Run dev:

```bash
pnpm --filter web dev
# http://localhost:3000
```

### 7.2 Briefing Claude Code well — the patterns that worked

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

### 7.3 Manually provisioning a user (closed beta)

While we're in closed beta, accounts are created by the owner via the
Supabase Studio dashboard. Two routes:

**A. Supabase Studio (recommended)**

1. Supabase Dashboard → Authentication → Users → **Add user**.
2. Enter email + a strong initial password.
3. Tick **Auto Confirm User** so they can sign in immediately.
4. Save.
5. Share the credentials securely (1Password share, Bitwarden Send, signal
   message). Never via plain email.
6. Send them the magic link: tell them to hit `/login`, sign in, and
   immediately reset their password from Supabase (password-reset email).

**B. SQL via the Supabase SQL Editor (advanced)**

Paste this into Supabase Studio → SQL Editor. It uses `pgcrypto`'s
`crypt()` + `gen_salt('bf')` to bcrypt the password the way GoTrue
expects. `email_confirmed_at = now()` skips the confirmation email
so they can sign in immediately:

```sql
insert into auth.users (
  instance_id, id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'jane@example.com',
  crypt('strong-temp-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);
```

The trigger on `auth.users` populates `public.users` automatically.

(The earlier draft of this doc referenced `auth.admin_create_user` —
that's a method on the JS admin SDK, not a SQL function. Use the
insert above, or the Studio UI in option A.)

**Re-opening public sign-ups later:**

1. Supabase Dashboard → Authentication → Providers → re-enable
   *Allow new users to sign up*.
2. Vercel → Settings → Environment Variables → set
   `NEXT_PUBLIC_SIGNUPS_OPEN=true` and redeploy.
3. The `/signup` page reverts to the live sign-up form automatically.

If you only flip one of (1) or (2), the system errs on the side of
*closed* — Supabase refuses to create users if (1) is off, and the
`/signup` page shows the closed-beta state if (2) is off.

### 7.4 Other common operations

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

After applying — **update OVERVIEW §4.3** with the new table.

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

### 7.5 Deploying

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
*Promote to Production*.

### 7.6 Where to look when something breaks

| Symptom                                  | Look here                                                       |
|------------------------------------------|-----------------------------------------------------------------|
| Render starts but never finishes         | fal dashboard → queue → check the request ID stored on `renders.fal_request_id`. Vercel function logs for `/api/renders/[id]/status`. |
| Render returns garbage / drifting walls  | `lib/styles.ts → buildPrompt`. Confirm strength is 0.70, canny is on, prompt is grounded in vision facts. |
| Picking list shows architecture          | `lib/matching.ts → validateBoxesWithClaude`. Confirm the validator pass is running and Haiku key is live. |
| "Bucket not found" on upload             | Supabase Storage → confirm the `rooms`, `renders`, `staged_images` buckets exist and are private. |
| Auth redirects break                     | Supabase → Auth → URL Configuration → confirm Vercel domain is in Site URL + Additional Redirect URLs. |
| Vercel says "No Next.js version found"   | Settings → General → Root Directory must be `apps/web`. |
| Upload fails silently on phone           | Look for the 4.5MB body cap — the client-side resize in `upload-form.tsx` should be downscaling, but a truly massive HEIC can sneak through. |
| Designer read is empty                   | `lib/designer.ts` — confirm `ANTHROPIC_API_KEY` is set and the system prompt loads. |
| Trend cards section missing              | `trend_cards` table is empty. Run the trend generator. |
| New user can't sign up                   | By design — closed beta. See §7.3 to provision manually.        |
| Existing user can sign in but `/signup` lets new ones through | `NEXT_PUBLIC_SIGNUPS_OPEN` is true. Set to `false` in Vercel and ensure Supabase signup is disabled too. |

### 7.7 Cost levers

| Lever                                   | Effect                                                  |
|-----------------------------------------|---------------------------------------------------------|
| Cache `rooms.analysis`                  | Done. We never re-pay vision for the same photo.        |
| Multi-product staging                   | Done. N items → 1 Flux Pro Fill call.                   |
| Lower Florence-2 to one pass            | Cheaper, but density drops. Tune per cohort.            |
| Switch Sonnet → Haiku for designer read | Cheaper. Quality drops noticeably; only do for free tier if margins tighten. |
| Pre-render trend cards weekly           | Spreads cost; users see fresh imagery at marginal cost. |

### 7.8 API keys + accounts to know about

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

### 7.9 Working with the agent on a new feature — end-to-end example

> **You:** "Add labour & install cost estimates to the project review
> page. For each completed render, take the picking list and add a 10%
> install line on furniture + a flat $400 styling line. Show it under the
> existing cost rollup with a small caveat. Editorial brand."
>
> **Claude:** reads `apps/web/app/projects/[id]/page.tsx` and the cost
> rollup component, plans the change, edits the component, runs
> `pnpm tsc --noEmit`, commits as
> `feat(web): add labour & install line items to project rollup`,
> updates OVERVIEW §5.2 + §6.7, pushes, and reports the commit SHA +
> Vercel deploy URL.
>
> **You:** check `/projects/[id]` once Vercel finishes. If it's wrong,
> brief the next change against the live page.

That's the loop. Brief → ship → review → brief again.

---

## 8. Appendix

### 8.1 Repo layout

```
myhome/
├── CLAUDE.md             ← Claude Code working instructions (auto-loaded)
├── apps/
│   ├── web/              ← Next.js 16 app (deployed to Vercel)
│   │   ├── app/          ← App Router routes
│   │   │   ├── api/      ← Server routes (render, stage, projects, ...)
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   ├── renders/
│   │   │   ├── rooms/
│   │   │   ├── login/    ← editorial brand
│   │   │   ├── signup/   ← editorial brand + closed-beta state
│   │   │   └── page.tsx  ← landing, editorial brand
│   │   ├── components/   ← shared UI (dashboard/, renders/, projects/, saltbush/, ui/)
│   │   ├── lib/          ← server-side helpers (fal, vision, designer, matching, staging)
│   │   └── tailwind.config.ts
│   └── scraper/          ← standalone pnpm app for catalogue + trends
│       ├── scrapers/     ← cocoRepublic.js, poliform.js, globeWest.js
│       ├── scripts/      ← ingest, embed, embed-knowledge, generate-trends
│       └── data/         ← design-knowledge-seed.json
├── supabase/migrations/  ← timestamped SQL migrations
├── docs/
│   ├── OVERVIEW.md       ← you are here (living doc)
│   ├── DESIGN-BRIEF.md   ← editorial brand spec (still current)
│   ├── ARCHITECTURE.md   ← historical (M0 FastAPI era)
│   ├── DEPLOY.md         ← historical
│   └── SETUP.md          ← historical
├── BRIEF.md              ← original product brief (M0–M2)
└── README.md
```

### 8.2 Where the older docs are still useful

- **`docs/DESIGN-BRIEF.md`** — the editorial brand spec. Still current.
  Refer to it when adding new surfaces.
- **`docs/ARCHITECTURE.md`** — historical. Pre-dates the move to a
  Next-only stack. Read for context, don't follow its setup.
- **`docs/SETUP.md` / `docs/DEPLOY.md`** — pre-Vercel-only era. Read
  §7 of this doc instead.
- **`BRIEF.md`** — original M0–M2 product brief. We're well past M2 but
  the proposition + design principles still apply.

### 8.3 Naming conventions

- Branches: short kebab — `fix/picking-list-mobile`, `feat/clients-crud`.
- Commits: Conventional Commits — `feat(web): ...`, `fix(web): ...`,
  `chore(web): ...`. Scope is `web` for the app, `scraper` for catalogue
  work, `docs` for documentation.
- API routes: kebab — `/api/analyse-room`, `/api/stage-multi`.
- React components: kebab files, PascalCase exports.
- Tables: snake — `shortlist_items`, `trend_cards`.

### 8.4 Glossary

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
- **Closed beta** — current state. Public sign-ups are paused; accounts
  are manually provisioned by the owner (see §7.3).
