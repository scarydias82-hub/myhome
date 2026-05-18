# Project Brief: AU Interior Design AI (working name: TBD)

> **Hand this file to Claude Code as the starting context.** Place it at the repo root as `BRIEF.md` and reference it in your first prompt: *"Read BRIEF.md and let's start on M0."*

---

## 0. Repo context

- There is an **existing GitHub repo** for this project. It currently contains only a README.
- **Work directly in this repo.** Do not scaffold a new one. Do not create a fresh git history.
- Before touching anything, run `git status` and `ls -la` to confirm what's there.
- All scaffolding goes inside the existing repo root.
- Commit in small, atomic, well-named commits (Conventional Commits style: `feat:`, `chore:`, `fix:`). Push to `main` unless told otherwise.
- If the README has anything useful (project name, license, notes), keep it and append to it rather than overwriting.
- Add a `.gitignore` early — Node, Python, `.env`, `.next/`, `__pycache__/`, `.venv/`, `.DS_Store`.

---

## 1. The product in one paragraph

A mobile-first web app that lets an Australian user (a) connect their Pinterest account so the AI can read their inspiration boards, (b) take a photo of an actual room in their home, and (c) get back a **photorealistic** restyled version of that exact room — same walls, windows, doors, ceiling — populated with furniture and decor that match the Pinterest aesthetic. Every item shown in the rendered image must be a **real product currently available from an Australian retailer**, surfaced as a shoppable picking list with prices, dimensions, retailer name, and a buy link.

**Non-negotiables:**
1. Photorealism. Output must be indistinguishable from a real interior photo at first glance.
2. Architecture preservation. Walls, windows, doors, floors must not move or warp between input and output.
3. Real products only. No "AI-shaped" furniture that doesn't exist. Every visible major item maps to a real SKU with a real price in AUD.
4. AU-first catalog. Prices in AUD, shipping notes for AU, GST-inclusive.

---

## 2. Tech stack (opinionated — change only with reason)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui | Fast iteration, good mobile, easy deploy |
| Backend | FastAPI (Python 3.11+) | All the vision/ML libs are Python-native |
| Database | Postgres via Supabase + `pgvector` extension | One service for DB, auth, storage; vector search built in |
| File storage | Supabase Storage (room photos, generated renders) | Same provider, signed URLs |
| Auth | Supabase Auth (email + Google) + custom Pinterest OAuth flow | Pinterest needs its own OAuth |
| Image generation | **fal.ai** (Flux.1 [dev] + ControlNet Depth) for MVP | Faster cold starts and cheaper than Replicate for Flux |
| Depth estimation | Depth Anything V2 (via fal.ai endpoint) | Current SOTA for monocular depth |
| Segmentation | SAM 2 (via fal.ai or Replicate) | Object masking on input + output |
| Vision embeddings | SigLIP (via Hugging Face Inference or self-hosted) | Better than CLIP for product similarity |
| Hosting | Vercel (frontend) + Fly.io (backend) | Both have decent AU/SG edge |
| Queue | Inngest or simple Postgres-backed job table | Render jobs are async and >10s |
| Monitoring | Sentry + PostHog | Errors + product analytics |

**Do not** self-host GPUs in Phase 1. Pay per-call until unit economics are proven.

---

## 3. System architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Next.js app │────▶│  FastAPI API    │────▶│  Job queue       │
│  (Vercel)    │     │  (Fly.io)       │     │  (Postgres)      │
└──────────────┘     └─────────────────┘     └──────────────────┘
                            │                         │
                            ▼                         ▼
                    ┌────────────────┐      ┌──────────────────┐
                    │  Supabase      │      │  Worker (Fly.io) │
                    │  Postgres +    │◀─────│  - fal.ai calls  │
                    │  pgvector +    │      │  - SAM/SigLIP    │
                    │  Storage       │      │  - product match │
                    └────────────────┘      └──────────────────┘
                            ▲                         │
                            │                         ▼
                    ┌───────┴────────┐      ┌──────────────────┐
                    │  Pinterest API │      │  Product catalog │
                    │  (on-demand)   │      │  ingestion (cron)│
                    └────────────────┘      └──────────────────┘
```

### Critical legal/architectural constraint: Pinterest
Pinterest's developer policy **forbids storing pin data server-side**. Their rule is: call the API each time, only use one user's data for that user, do not combine with other users' data.

**This means:** when a user connects Pinterest, fetch boards → vision-analyze each pin → derive a per-board *style vector + tags* → **store only the derived signal**, not the pin images or URLs. Re-fetch if the user wants fresh analysis. Document this in the privacy policy.

---

## 4. Core pipeline (the magic loop)

Given a room photo and a style profile, the worker runs:

1. **Analyze room** (~3s)
   - Run Depth Anything V2 → depth map
   - Run SAM 2 with category prompts (`wall`, `window`, `door`, `floor`, `ceiling`, `sofa`, `chair`, `table`, `rug`, `lamp`, `art`) → masks
   - Classify room type (living/bed/dining/etc.) — small CLIP classifier or rule on detected objects
   - Persist: depth map, masks, room_type to storage

2. **Generate restyled render** (~15–30s)
   - Build prompt from style profile: `"{style_descriptor} {room_type}, {palette_words}, {material_words}, photorealistic interior photography, natural light, 35mm, architectural digest"`
   - Negative prompt: `"cartoon, illustration, distorted, warped walls, extra windows, low quality"`
   - Call Flux + ControlNet Depth with the depth map as conditioning, strength ~0.85
   - Optionally also pass MLSD line conditioning to lock straight architectural lines

3. **Detect products in render** (~3s)
   - Run Grounded SAM on the *output* image with the same category prompts as step 1
   - For each detected region: crop, store mask + bounding box

4. **Match to real products** (~2s per item, parallel)
   - For each cropped item region: embed with SigLIP
   - Vector search in `products` table filtered by detected category and price band (user preference)
   - Return top 5 matches with price, dimensions, retailer, affiliate link
   - Score by similarity + in-stock + delivery-to-AU

5. **Assemble response**
   - Restyled image URL
   - Picking list: array of `{ item_label, position_on_image, matches: [Product] }`
   - Total cost range
   - "Style confidence" score

Target end-to-end: **under 45 seconds** for first render. Show progress UI.

---

## 5. Phased build plan

Each milestone must end with something demoable.

### M0 — Skeleton (3–5 days)
- [ ] Monorepo: `apps/web` (Next.js), `apps/api` (FastAPI), `packages/types` (shared TS types)
- [ ] Supabase project: auth, `users`, `rooms`, `renders`, `products`, `style_profiles` tables
- [ ] `pgvector` extension enabled
- [ ] Deploy: Vercel + Fly.io, with env var management
- [ ] Health check endpoint, error logging (Sentry), analytics (PostHog)
- [ ] Sign up, log in, log out

### M1 — Core render pipeline (1–2 weeks)
- [ ] User can upload a room photo (drag-drop on web, file picker on mobile)
- [ ] User picks a style from a hardcoded list of 8 (Coastal, Japandi, Hamptons, Mid-Century, Industrial, Boho, Contemporary AU, Minimalist)
- [ ] Backend job runs the depth + segmentation + generation pipeline
- [ ] User sees before/after slider with restyled photorealistic render
- [ ] **No products yet** — just prove the render quality is good

**Definition of done:** Render quality passes the "would you believe this is a real room photo?" test on 10 test photos across 4 room types. Walls/windows do not move.

### M2 — Product graph + picking list (2–3 weeks)
- [ ] Catalog ingestion service that pulls CSV/XML product feeds and writes to `products` table with SigLIP embeddings
- [ ] Seed catalog: scrape 200 products manually from Temple & Webster, Castlery AU, IKEA AU, Freedom — enough to demo
- [ ] Apply to Commission Factory for affiliate access (parallel — takes days)
- [ ] Object detection on output → vector search → top 5 matches per detected item
- [ ] Picking list UI: click any item in the render → side panel showing matches with price, retailer, image, buy button
- [ ] Total estimated cost in AUD

**Definition of done:** For a restyled image, every major item (sofa, coffee table, rug, side table, lamp, art) shows ≥3 real product matches with prices.

### M3 — Pinterest integration (1–2 weeks)
- [ ] Pinterest OAuth flow with `boards:read` and `pins:read` scopes
- [ ] "Connect Pinterest" CTA in onboarding
- [ ] Backend: fetch user's boards, list them, let user pick 1–3 inspiration boards
- [ ] For each selected board: fetch pins (paginated), vision-analyze each pin, derive a board-level style profile (style descriptor, palette, materials, formality, mood)
- [ ] **Do not persist pin images or URLs.** Only persist the derived `style_profiles` row.
- [ ] User can now render with "My Pinterest style" instead of a hardcoded style

**Definition of done:** Connecting a real Pinterest board produces a noticeably distinct render style vs the hardcoded options.

### M4 — Polish & launch prep (1–2 weeks)
- [ ] Save renders, share renders (public link with watermark)
- [ ] Affiliate link wiring (Commission Factory / Impact deep links, with required ACCC disclosure)
- [ ] Privacy policy + ToS (must mention Pinterest data handling explicitly)
- [ ] Onboarding flow with sample room photo for users who want to try before uploading
- [ ] Basic dashboard: my rooms, my renders, my saved products
- [ ] Mobile camera capture (use `<input type="file" accept="image/*" capture="environment">`)

---

## 6. Data model (Postgres)

```sql
-- Core entities
users (id, email, created_at, pinterest_connected_at, ...)

rooms (id, user_id, photo_url, depth_map_url, masks_json, room_type, created_at)

style_profiles (
  id, user_id, source ('pinterest_board' | 'hardcoded' | 'custom'),
  source_ref text,                       -- board id if pinterest, never store pin urls
  style_descriptor text,                 -- "warm Japandi"
  palette jsonb,                         -- ["#D9C7A7", "#8B7355", ...]
  materials text[],                      -- ['oak', 'linen', 'rattan']
  mood text[],                           -- ['calm', 'organic']
  embedding vector(1152),                -- SigLIP embedding
  created_at, expires_at
)

renders (
  id, user_id, room_id, style_profile_id,
  output_url, picking_list jsonb,
  cost_estimate_aud numeric,
  status, created_at, completed_at
)

products (
  id, retailer text, sku text, name text,
  category text,                         -- 'sofa', 'rug', etc.
  price_aud numeric, image_url text, product_url text,
  affiliate_url text,
  dimensions jsonb,
  materials text[], colors text[],
  in_stock boolean, ships_to text[],
  embedding vector(1152),
  last_seen_at timestamp,
  unique(retailer, sku)
)
create index on products using hnsw (embedding vector_cosine_ops);

-- Pinterest: nothing persisted from their API except style_profile rows
```

---

## 7. External accounts to set up before coding

| Service | What for | Notes |
|---|---|---|
| Supabase | DB, auth, storage | Free tier OK to start |
| Vercel | Frontend hosting | Connect to GitHub |
| Fly.io | Backend + worker | AU region: `syd` |
| fal.ai | Flux + ControlNet, SAM2, Depth Anything | Pay-as-you-go; budget ~$50 for M1 testing |
| Hugging Face | SigLIP inference (or self-host later) | Free tier limited; may need PRO |
| Pinterest Developer | OAuth app | Apply for production access early — review can take 1–2 weeks |
| Sentry | Errors | Free tier |
| PostHog | Analytics | Free tier |
| Commission Factory | AU affiliate network for retailers | Apply early; approval takes days |
| Impact | Backup affiliate network | Some retailers only here |

---

## 8. Gotchas to flag for the engineer

1. **ControlNet strength is the magic dial.** Too low and the room changes; too high and the style doesn't take. Expose this as a slider during dev, hide it in prod once tuned per room type.
2. **Generated rooms often invent a second window.** Combine depth + MLSD line conditioning if this happens, and add to negative prompt.
3. **Product matching by image alone is unreliable for "rug" and "art".** Use category-restricted search; lean on metadata (color, style tags) heavily for these.
4. **Pinterest pins are often not actual products** (they're aspirational images, magazine clippings). Don't try to match pins to products directly — analyze them for *style signal* only, then match style → AU products.
5. **Australian Consumer Law requires affiliate link disclosure.** Add a clear disclosure line: "Some links earn us a commission at no extra cost to you."
6. **Photorealism degrades on iPhone photos taken in low light.** Add a pre-flight check on the uploaded photo: brightness, blur, aspect ratio. Reject and prompt re-shoot if poor.
7. **fal.ai cold starts.** Pre-warm endpoints during a user's onboarding flow so the first render isn't 60s.
8. **Cost per render at MVP:** ~$0.10–0.30 in inference. Bake this into the pricing model. Free tier should cap at 3 renders/day.

---

## 9. First task for Claude Code

When you start the session, paste:

> "Read `BRIEF.md`. The repo already exists — run `git status` and `ls -la` first to confirm what's here, then work directly in it (do not scaffold a new repo). We're starting on **M0 — Skeleton**. Set up the monorepo with `apps/web` (Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui) and `apps/api` (FastAPI). Add a sensible `.gitignore`. Configure Supabase with the schema from section 6 (just `users`, `rooms`, `renders`, `style_profiles`, `products` — empty for now). Set up auth (email + Google). Add a placeholder dashboard page behind auth. Get it deploying to Vercel + Fly.io. Commit in small atomic commits with Conventional Commits messages. Stop and show me before moving to M1."

---

## 10. Decisions to revisit later

- Web vs native mobile app (web-first for MVP; native if AR/LiDAR room measurement becomes a feature)
- Self-hosted GPU vs hosted inference (revisit at 1000 renders/day)
- Pricing model: subscription, per-render credits, or pure affiliate (likely hybrid)
- B2C vs prosumer/designer tier (start B2C, watch for designer signups, build a Pro tier if they show up)
- Geographic expansion beyond AU (NZ is the obvious second; US is crowded)

---

*End of brief.*
