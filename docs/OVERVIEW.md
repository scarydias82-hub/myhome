# myMaison — overview

The **living source of truth** for the business, the strategy, the system,
the product today, the roadmap, and the how-to for operating it with Claude
Code.

**Last verified:** 2026-05-25 · most recent material commit: `dbb702f` (will
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

- `2026-05-25` — **Composite: reject black-background cutouts at source
  instead of pasting them onto the room.** First Coco-only render test
  surfaced black rectangles in the multi-stage "Stage 3 Together"
  modal — each cutout (Otis lamp, Frankie bedside, Parisian Loft Bed)
  was being composited onto the original room photo with a clean black
  rectangle around the product. Diagnostic (`renders.auto_stage_status:
  null` + `auto_stage_error: null` + the cutouts visibly opaque-black)
  pointed at birefnet returning unusable cutouts — either a re-encoded
  source image (no actual background removal) or a JPEG with black
  where transparent pixels should be. Sharp's `.ensureAlpha()` (#166,
  #171) wrapped these in RGBA without changing the underlying pixels;
  the #178 detection skipped the drop shadow but still pasted the
  cutout layer as-is. Net effect: black-rectangle composites.

  Fix: alpha validation moved upstream into `cutoutProduct()` itself.
  After fetching from birefnet, the function now:
  1. Logs the response Content-Type + URL extension for diagnostic
     (so we can confirm in future whether the failure mode is
     birefnet returning JPEG vs PNG-with-fake-alpha)
  2. Normalises the buffer to RGBA via `sharp().ensureAlpha().png()`
     and reads the alpha channel's stats
  3. Applies the SAME threshold pair as the composite-side #178
     check (alpha min < 250 AND mean < 240) — but uses it to REJECT
     the cutout rather than silently render as a rectangle
  4. Throws a clearly-labelled error when alpha is fake, with all
     the diagnostic context (content-type, URL extension, length,
     alpha stats) so the caller's `Promise.allSettled` in
     `staging.ts` logs per-item detail in
     `renders.auto_stage_error`

  Net effect: the multi-stage modal will surface "we couldn't isolate
  product X" failures cleanly instead of pasting black rectangles
  onto the room. Worse-looking UX for those products, but honest;
  the catch handler upstream can render a fallback placeholder or
  surface the failure to the user.

  Follow-up tracked separately: WHY is birefnet returning unusable
  cutouts for Coco's hi-res 2560w product images? Coco's images have
  clean neutral backgrounds — birefnet should handle them easily.
  Suspects: image size too large for birefnet (2560w → could be
  hitting an internal cap), or our `fetchProductImageAsDataUrl`
  base64 encoding mid-pipe is corrupting bytes, or the model
  genuinely struggles with certain product photography. Worth a
  dedicated debugging session against the raw cutout bytes.
- `2026-05-25` — **Render flow simplification: tighter upload page,
  1-per-category picker, brief render commentary with expand.** Owner
  directive — strip clutter from the upload → palette → product flow
  so users don't scroll past walls of Claude commentary to get to the
  picker, and shorten the post-render commentary to a product summary
  by default. Four coordinated pieces:

  **Upload flow** (`apps/web/components/rooms/upload-form.tsx`).
  - Removed `RecommendationSourceBanner` (the prefs-chips +
    "Customise for this image" CTA from §6.11 Phase C / #155). Was
    clutter between the analysis card and palette picker.
  - Removed `DesignerSummaryCard` rendering (component def stays as
    dead code for now). The room-read sentence + reasoning paragraph
    crowded the page; `Step3Style` palette picker that follows is
    already the "brief recommended palette + override" surface.
  - Auto-opens `CurationStep` once `analysisConfirmed && paletteId`
    via a new `useEffect`. New `loadedForPaletteId` state guards
    against duplicate fetches and refires the open when the user
    picks a different palette. "Browse the designer's edit" button
    stays as a recovery path if the auto-fetch fails.

  **Picker: variable pick count per category (default 1, some 2).**
  - `togglePick` flipped from "max 3 per category" (1-3 picks model
    from #179 PR #25) to **variable max via `pickCountForCategory`** —
    most categories cap at 1, pair / variety categories cap at 2
    (Bedside Table, Table Lamp, Side Table, Dining Chair, Stool).
    Clicking a selected card deselects; clicking unselected adds
    until cap; clicking unselected at capacity is ignored until user
    deselects another.
  - New `CATEGORY_PICK_COUNT` config + `pickCountForCategory(label)`
    helper at the top of `upload-form.tsx`. Both singular + plural
    category forms are mapped to the same count so any retailer's
    labels work (Coco "Sofa" + Freedom "Sofas" both resolve to 1).
  - `CurationStep` heading + helper copy + per-card counter all
    reflect the variable count: "Pick 1" / "Pick 2" / "1 of 2
    picked" / "Selected" depending on state. Card disabled-state
    re-introduced for the "at capacity" case (no card to add to
    until the user deselects one).
  - Rooms that visually need many of the same thing (a set of dining
    chairs around a table, two bedside tables flanking a bed) are
    handled by the renderer prompt below — the user picks one chair
    model and gpt-image-1 places coordinated copies. Picking 2 of a
    pair-category (Bedside Table) lets the user mix two styles in
    the rendered scene.

  **Renderer: multi-instance prompt for the right categories.**
  - `buildOpenAIImagePrompt` in `lib/openai-image.ts` gains a new
    `MULTI_INSTANCE_CATEGORIES` set (dining chairs, bedside tables,
    lounge chairs, armchairs, stools — both singular + plural forms
    so any retailer triggers it). For products in those categories,
    the per-product placement directive becomes "Place multiple
    matching instances of this exact piece as the room composition
    requires — e.g. a set of 4-6 around a dining table, a pair
    flanking a bed." Other categories keep the single-instance
    directive. Single user pick → coordinated multi-instance render.

  **Render-page commentary: brief default + expand.**
  - `designer-system.md` adds a new **PRODUCT SUMMARY** output block
    as the first section (before DESIGNER READ / PALETTE STORY /
    EXPLORE INVITE). One line, comma-separated products with a
    single material/colour adjective each — e.g. *"Linen cream sofa,
    oak coffee table, sculptural travertine lamp."* 6-12 words, no
    verb, no story.
  - `lib/designer.ts` `DesignerAdvice` adds optional `productSummary:
    string`. `parseDesignerOutput` extracts the new section.
  - `components/renders/designer-read.tsx` `AdviceBlock` defaults to
    showing only the PRODUCT SUMMARY one-liner with a
    "+ Read the designer's take" toggle that reveals the existing
    three long-form sections. Backward-compat: rows missing
    `productSummary` (anything rendered before this prompt change)
    auto-expand the long-form so the user still sees something
    useful and the toggle hides.
- `2026-05-25` — **Render test mode: retailer allowlist + multi-angle
  product references.** Two related changes to support the post-Coco-
  rescrape render quality test.
  (1) New `RENDER_RETAILER_ALLOWLIST` env var (comma-separated retailer
  names). When set, scopes every render-pipeline product candidate
  fetch to those retailers only — `lib/curation.ts` (the picking-step
  candidate fetch + the wishlist join), `lib/designer.ts` (narrator
  candidate fetch), and `lib/matching.ts` (vision_profile RPC, CLIP
  pre-rank RPC, and both fallback queries). RPC results are post-
  filtered in memory since the RPCs don't accept a retailer param.
  Paint queries in matching.ts are intentionally exempt — wall paint
  is its own pipeline and scoping it would zero out wall colour
  rendering. Unset in production = no filter (default behaviour).
  Used during the Coco-only render quality test as
  `RENDER_RETAILER_ALLOWLIST=Coco Republic`.
  (2) Renderer now sends up to 2 angles per product to gpt-image-1's
  multi-image reference input. `HeroProductDescriptor.imageUrls?: string[]`
  threaded from `products.image_urls[]` through `/api/render` →
  `lib/openai-image.ts`. `pickRenderReferenceUrls()` filters out
  lifestyle / styled-room shots via a BigCommerce filename heuristic
  (`_Lifestyle_` substring) so the renderer only sees product-on-
  neutral-background references — lifestyle shots carry surrounding
  context the model can splice into the output scene. Cap = 4 products
  × 2 angles = 8 product images, plus 1 room + 1 palette = 10 total,
  well under gpt-image-1's 16-image hard limit. `openai-image.ts`
  productImageBufs cap bumped 4 → 10. Caller-side caps in render
  route. Backward compatible — products without `image_urls` fall back
  to single `imageUrl` and the renderer behaves exactly as before.
- `2026-05-24` — **Coco Republic scraper rebuilt — bcJsContext +
  multi-image + hi-res, owner-narrowed to 9 hero categories.** Owner
  directive: get the premium-tier catalogue right before relying on
  it for render-substitution + vision matching. Three shape changes:
  (1) **Source** flipped from JSON-LD to BigCommerce's inline
  `bcJsContext` JSON blob. JSON-LD only ever exposed `image[0]` and a
  single price; bcJsContext carries the full product object — all
  5-20 images, full breadcrumb category path, full price model
  (sale/non-sale), structured options for the variant on the page,
  and richer custom_fields. (2) **Multi-image** — every image
  returned by the product, not just the hero. Substituted into the
  CDN URL via the `{:size}` placeholder for hi-res. Threaded through
  ingest into the new `products.image_urls text[]` column
  (migration `20260524000000_products_image_urls.sql`); existing
  `image_url` text column stays as the canonical primary, image_urls
  carries the rest in display order. NULL for retailers that surface
  only a single image — no backfill needed. (3) **Hi-res** — new
  `downloadImage({ resize: false })` mode bypasses the default
  1200px / JPEG-q85 transcode and writes source bytes as-is.
  Extension detected from Content-Type (jpg / png / webp / avif).
  Coco's images land at native 2560w (~1.5-2MB each) for vision
  profile fidelity + future render-substitution compositing. Other
  scrapers keep the resize default unchanged.
  Coco taxonomy narrowed to the 9-category list the owner asked for,
  written in the **singular form** the owner specified — Sofa, Chair,
  Lounge Chair, Dining Chair, Dining Table, Bed, Bedside Table,
  Floor Lamp, Table Lamp. (Other scrapers still write plural — both
  forms are listed under each canonical in
  `apps/web/lib/curation.ts` CATEGORY_FAMILIES so the matcher finds
  Coco rows under existing plural queries. Lounge Chair + Lighting-
  family aliases added in the same commit so Coco's Lamp /
  Lounge Chair rows surface under the Lighting / Chairs canonicals
  used by CORE_CATEGORIES_PER_ROOM.) Anything outside that set is
  filtered at the category gate so we don't burn requests / disk on
  artwork, cushions, swatches, etc. Per-URL = per-variant naturally
  because Coco publishes per-variant pages — no variants JSON
  column needed.
  Wipe + rescrape sequence: owner runs
  `DELETE FROM products WHERE retailer = 'Coco Republic';` (cascade
  removes any featured_products / user_wishlist / vision_boards rows
  linking to old Coco products — minimal in closed beta), then
  `pnpm --filter @myhome/scraper scrape:coco`, then ingest, then
  `pnpm --filter @myhome/scraper run vision-profile -- --retailer=coco-republic`
  to re-derive vision_profile for the new rows.
- `2026-05-24` — **Tighter "no shadow" gate in the cutout pipeline
  — kill the dark-blob artifact when birefnet barely-cuts a
  lifestyle-scene product.** Owner ran a post-render compositing
  pass and got product cards with dark/black backgrounds.
  Background: the staging pipeline (`apps/web/lib/composite.ts`)
  pushes each `products.image_url` through birefnet (fal-ai cutout
  model) before compositing into the scene. Birefnet works
  brilliantly on clean studio product shots but degrades when the
  input is a lifestyle scene (typical for rugs, where retailers
  default to room-context photography). Three earlier fixes
  (#166 ensureAlpha, #170/#171 per-item fault tolerance, #178 skip
  shadow when alpha is fully opaque) addressed the crashes and the
  worst "solid black box" failure mode. #178 in particular checked
  `alpha.min < 250` — i.e. "there's at least one transparent pixel
  somewhere" — to decide whether to render a drop shadow. That
  catches the fully-opaque ensureAlpha-fake-alpha case, but it
  passes through a NEW failure mode: birefnet runs on a lifestyle
  scene, finds a thin transparent border around the whole image
  (so min drops to ~0-20), but the body of the image stays opaque
  (no real product silhouette to isolate). Mean alpha ends up near
  250+ — the existing min check thinks "real cutout, go ahead and
  shadow", the blurred-shadow code then darkens the entire product
  region into a dark blob. Fix in `composite.ts:342-381`: keep the
  `min < 250` check AND require `mean < 240`. Both thresholds must
  pass for `hasRealAlpha`. Pure ensureAlpha-opaque fails on min;
  birefnet-found-the-border-but-not-the-product fails on mean;
  genuine cutouts (sofa on white studio backdrop → alpha mean
  100-180) pass both. Also: the suspect-alpha warn log now
  includes `min/mean/max` so future eyeballing of birefnet
  edge cases doesn't need a repro. No DB / scraper changes —
  pure pipeline tighten. Doesn't fix the underlying source-image
  quality problem for rugs (separate ticket — would need either
  a vision quality gate at ingest or scraper second-pass for
  flat-lay variants), but eliminates the visual artifact when
  birefnet output is borderline.
- `2026-05-24` — **Curation submit button stuck disabled when any
  category has zero candidates.** Follow-up to the lounge_room fix.
  Owner re-ran the render: products now appear (good), but the
  "Render with these N picks" button stayed greyed out. Root cause
  in `apps/web/components/rooms/upload-form.tsx`: the gating helper
  `allCategoriesHavePick` required `picks.get(cat.displayLabel).size
  >= 1` for EVERY core category. If a category came back with zero
  candidates (e.g. Dining Tables in the chosen palette had no
  matches in the catalogue), there was literally nothing to pick,
  so the constraint could never be satisfied and the user was
  locked out. The empty-state already showed the right hint ("No
  catalogue matches in this palette — try another palette") but
  the CTA stayed disabled regardless. Fix: empty categories
  auto-satisfy the gate (`cat.items.length === 0 || picks ≥ 1`),
  and the misleading "0 / 3 picked · required" eyebrow now reads
  "No matches" for those categories so it lines up with the hint
  below. Lets the user proceed without backtracking through palette
  choice when they're happy with the picks they do have.
- `2026-05-24` — **Picking step empty-result fix — `lounge_room` slug
  mismatch + missing category-only fallback.** Owner reported an
  earlier render where the curation step returned zero products
  across every category. Root cause: the vision schema
  (`lib/vision.ts`) emits `room_type = "lounge_room"`, but the
  catalogue's `room_tags` taxonomy
  (`apps/scraper/utils/productTags.js` + the `recommended_rooms`
  arrays in `palettes.json`) only ever uses `"living_room"` —
  zero occurrences of `lounge_room` anywhere in the tag pipeline.
  `lib/curation.ts:fetchCurationCandidates` then built
  `roomFilter = ['lounge_room', 'any']`, which doesn't overlap
  any sofa / coffee table / rug row in the DB. All three tiers
  (palette+room+style, palette+room, room-only) returned 0, the
  panel rendered empty, the user couldn't pick anything. The
  post-render `lib/matching.ts:fetchCandidates` had the same slug
  mismatch but masked it with a category-only legacy fallback at
  the bottom (`[matching] candidates(...): 0 — falling back to
  category-only`), so post-render product matching kept working
  even when the upfront picker silently broke. Fix: (a) new
  exported `normaliseRoomTag` helper in `lib/matching.ts` that
  aliases `lounge_room → living_room` and collapses `other` / null
  / empty to `undefined` so the catalogue-side query sees the
  canonical slug; (b) both `fetchCandidates` (RPC tiers 1 + 2 +
  the legacy filtered path) and `fetchCurationCandidates`
  (`roomFilter` + `CORE_CATEGORIES_PER_ROOM` lookup) route through
  the helper before hitting Supabase; (c) `fetchCurationCandidates`
  gains a Tier 4 category-only safety net mirroring matching.ts's
  legacy path — if any future room-slug drift leaves the first
  three tiers empty, the picker degrades gracefully instead of
  going blank. Side-cleanup: removed the now-redundant
  `lounge_room` key from `CORE_CATEGORIES_PER_ROOM` (the
  normaliser collapses it to `living_room` before the lookup).
  No DB migration. Added the missing **Designer-curated picking
  step** row to §5.2 — that pipeline stage shipped in #179 but
  was never recorded in the file-by-file table.
- `2026-05-23` — **Designer narrator gets a contemporary warm-
  minimalist baseline POV.** Owner directive: make every room the
  narrator describes feel calm, intentional, and contemporary —
  push the products in any render toward feeling like a curated
  contemporary interior rather than a catalogue stack. Scope is
  deliberately narrow: only the narrator prompt
  (`apps/web/lib/prompts/designer-system.md`) — render image
  generation (`lib/styles.ts`, `lib/kontextPrompt.ts`) is unchanged,
  so Flux still draws whatever style the user picked. What shifted:
  (a) new `## YOUR DESIGN POINT OF VIEW` section near the top of
  the prompt establishing warm minimalist contemporary as the
  default aesthetic compass — materials (pale oak, lime-washed
  plaster, sculptural travertine, oat linen, undyed bouclé), form
  (clean lines, soft sculptural curves, generous proportion),
  palette (warm neutrals + one considered accent, no jewel tones),
  mood (considered, calm, intentional). When the user picked a
  non-contemporary palette + product mix, the narrator still
  narrates THAT room on its own terms but finds the contemporary
  qualities inside it (restraint, considered proportion, material
  honesty). (b) Australian context bullets rewritten with an
  explicit contemporary lens — 2026 AU contemporary leans into
  sculptural form (soft arches, organic plaster, travertine slabs)
  and restrained palettes. (c) `lib/designer.ts` null-state palette
  fallback updated to default toward warm-minimalist contemporary
  when no palette has been selected, rather than the previous
  style-agnostic "infer most suitable" wording. Preserved: the
  3-section DESIGNER READ / PALETTE STORY / EXPLORE INVITE output
  contract, the don't-critique-the-original directive, the 60-30-10
  + scale + layering principles. Live on the next deploy — no DB
  migration, no client work needed.
- `2026-05-23` — **#158 Kmart scraper shipped — ultra-budget accent
  line, stools only (scope per owner).** Site is Next.js SSR fronted
  by Akamai's edge bot wall — homepage returns 200 but category pages
  return 403 until a session has computed the `_abck` sensor cookie
  (real-browser JS only). Vanilla Playwright + homepage warm-up
  passes the wall reliably. Scraper is lean: single category landing
  (`/category/home-and-living/stools/`), listing-only data extraction
  (skip per-product detail visits) since sub-$100 stools don't need
  precise dimensions for the picking list. One Playwright page visit
  total = minimal Akamai pressure. Target 30–50 products. Out of
  the §6.13 backlog the only remaining item is #156 IKEA, which the
  owner deferred (aggressive bot defence + lower ROI given Fantastic
  already covers the same budget price band). The catalogue now has
  representation in every tier from ultra-budget to premium.
- `2026-05-23` — **#157 Brosa scraper shipped — best-effort, DataDome-
  gated (mid tier).** brosa.com.au is fronted by DataDome bot
  protection — curl + Chrome UA returns the JS-challenge interstitial
  (403), and that includes the public sitemap. Vanilla Playwright with
  a real Chromium TLS fingerprint is the lowest-friction attempt;
  DataDome's JS challenge often auto-solves in a real browser context.
  The scraper warms up the cookie via homepage visit, detects whether
  the challenge persisted (signature: `captcha-delivery.com`), and
  aborts cleanly with a readable error if so — Promise.allSettled in
  the orchestrator records the failure without taking down the batch.
  URL guess (`/buy/<slug>` from the pre-Kogan Brosa pattern, confirmed
  to be a real path namespace via robots.txt `/br/buy/...` disallow
  rules) — the homepage warm-up dumps any visible nav links to stdout
  so a wrong guess is debuggable. Status will be confirmed on the first
  live run. If DataDome blocks it consistently, the fallback is
  `playwright-extra` + stealth plugin (heavier dep) or skip Brosa for
  a comparable mid-tier substitute like Castlery AU. #155 Amart
  Furniture deferred per owner — gap covered by Adairs / Beacon
  Lighting / Carpet Court for non-sofa mid-tier categories.
- `2026-05-22` — **#154 Fantastic Furniture scraper shipped (budget
  tier, first new retailer in the §6.13 rollout).** `apps/scraper/scrapers/fantastic.js`
  + wired into `index.js`, `package.json` (`pnpm scrape:fantastic`),
  and `retailerSegment.js` ('Fantastic Furniture' → 'budget'). Site is
  SAP Commerce Cloud behind Cloudflare with a 1.9KB SPA shell — needs
  Playwright + JS hydration. Strategy modelled on the Freedom scraper:
  Cloudflare cookie warm-up via homepage visit, then per-landing
  scrape with DOM + API-response interception (the SPA fires
  `api.fantasticfurniture.com.au` JSON during boot; we walk the
  responses for product URLs as a fallback when DOM hydration
  partially fails). Reconnaissance shortcut: their public
  `sitemap.xml` index exposes Category + Product sub-sitemaps —
  that's where the 9 canonical-category landing URLs came from
  (Sofas, Chairs ×2, Stools, Rugs, Lamps ×2, Wall Lights, Beds,
  Desks). Same per-landing 30–50 product cap pattern as Freedom.
  No migration needed — segment is tagged at scrape time via
  `segmentFor(RETAILER)` and threaded through ingest. New retailers
  don't need backfill SQL because they have no pre-existing rows.
- `2026-05-22` — **#153 market-segment plumbing shipped + Freedom
  catalogue extended (catalogue expansion budget-tier groundwork).**
  Every product now carries a `market_segment` tag so a global user
  preference ("show me budget options") can filter the catalogue
  contextually. Six tiers anchored to the AU furniture market:
  `ultra-budget`, `budget`, `budget-mid`, `mid`, `upper-mid`,
  `premium`. New util `apps/scraper/utils/retailerSegment.js` is the
  source of truth — every scraper imports `segmentFor(RETAILER)` and
  writes the tag on each product record; `scripts/ingest.js` passes
  it through into the new `products.market_segment` column (migration
  `20260522191500_products_market_segment.sql` — renamed from
  `20260522190000_...` during the 2026-05-23 merge to avoid timestamp
  collision with main's `20260522190000_users_preferences.sql`).
  Constraint allows
  NULL for catalogues where the concept doesn't apply (Dulux paint).
  Freedom scraper extended from 3 → 9 canonical categories: kept
  Sofas + Rugs + Mirrors, added Chairs (dining + armchairs), Stools,
  Lamps (table + floor), Wall Lights, Beds, Desks. Per-landing cap
  bumped from 30 → 50 with split caps on multi-URL canonicals so each
  canonical category lands in the 30–50 range. Sets up §6.13 for the
  budget-retailer rollout (Fantastic, Amart, IKEA, Brosa-if-live,
  Kmart accent line — one PR each) and the cross-segment
  similar-products substitution feature.
- `2026-05-23` — **#166 shipped — fix auto-stage alpha-channel crash
  + per-item fault tolerance.** First diagnostic-driven fix off the
  back of #165 observability. Render `57bddf98` came back with
  `auto_stage_status='failed'` and the error
  `Cannot extract channel 3 from image with channels 0-2` — a Sharp
  call expecting an alpha channel on a buffer that birefnet had
  silently returned RGB-only for one product. The whole 4-item
  batch crashed at the first bad cutout.
  Two-part fix:
  1. `lib/composite.ts` — added `.ensureAlpha()` to the resize chain
     in `addCutoutToLayers` so the subsequent
     `extractChannel('alpha')` is guaranteed an alpha channel. The
     product without a real cutout renders as a rectangle in the
     composite (still wrong-looking for that one item), but no
     crash.
  2. `lib/staging.ts` — switched the cutout step from `Promise.all`
     to `Promise.allSettled`. One broken cutout (404, birefnet
     timeout, malformed bytes) now logs `[staging] cutout failed`
     and is filtered out; the surviving items still composite into
     the render. Only fails the whole batch if EVERY cutout fails.
  Next auto-staged render should land. Migration `20260522220000`
  remains the only manual op needed.
- `2026-05-23` — **#169 shipped — designer-selecting overlay (scrolling
  palettes) + shorter reasoning + Read more toggle.** Two related UX
  changes to the post-photo, pre-render flow on `/rooms/new`:
  1. **Photo overlay**: replaced the static "Claude is reading your
     room…" overlay with a `DesignerSelectingOverlay` that sits on the
     photo across BOTH the vision pass and the recommend pass. A
     scrolling palette ribbon (CSS `@keyframes marquee` in globals.css,
     duplicated palette list for seamless loop) runs behind centred
     copy: "✦ Designer at work — The designer is choosing a direction
     for you…". Hides only once `analysing && recommending` are both
     false, i.e. when the `DesignerSummaryCard` has its reasoning to
     show. Companion cleanup: removed the redundant
     `CarouselRecommendingOverlay` that used to sit on the carousels
     in parallel (it duplicated the messaging and added visual
     noise).
  2. **Reasoning truncation**: `lib/brief/synthesiser.ts` prompt
     tightened from "2-3 sentence paragraph" to "ONE punchy sentence,
     max 30 words". `DesignerSummaryCard` extracts the reasoning into
     a new `ReasoningBlock` component that line-clamps to 3 lines on
     mobile by default and shows a "Read more ↓ / Less ↑" toggle when
     content exceeds ~160 chars (covers cached longer briefs from
     before this commit). New synthesis output is short enough that
     the toggle never appears; cached older briefs get the clamp +
     expand fallback.
  Net effect: the analyse → recommend phase reads as one continuous
  designer-at-work surface, and the post-recommend commentary stops
  eating mobile real estate.
- `2026-05-23` — **#168 shipped — collapse three palette carousels
  into one + filter chips.** The Step 03 palette picker on
  `/rooms/new` had three carousels that implied three independent
  choices (Colour palette + 2026 trend + Tried & tested with mutex)
  but were actually all sliced views of the same 56-palette list —
  picking from carousels ②/③ just overwrote the carousel ① pick.
  UX lied about the data model. Replaced with one carousel + three
  filter chips (`All · 56 / 2026 trends · N / Tried & tested · M`)
  and a single `UnifiedPaletteCard` that shows the trend-preview
  image as hero when available (falls back to the 5-column swatch
  strip) plus the trend / heritage label, palette name, vibe, and
  `trend_source` provenance on every card. The currently-selected
  palette is always pinned to the front of the visible list even
  when outside the active filter so switching filters never makes
  the user's pick disappear. Companion cleanup: removed the standalone
  `direction` React state (`'2026' | 'timeless' | null`) — it's now
  derived from the palette via the shared `paletteDirection()` helper
  (#167) wherever needed (DesignerSummaryCard label, banner copy).
  Net effect: less state to keep coherent, ~200 lines of duplicated
  carousel code gone, picker tells the truth about what choice the
  user is actually making.
- `2026-05-22` — **#165 shipped — auto-stage observability + open-plan
  prompt fix.** Two changes from a real production diagnostic on
  carydias@gmail.com's render (`546d0534`):
  1. **Open-plan wall hallucination, prompt fix.** Vision correctly
     captured `open_plan_zones` for the lounge_room render (kitchen +
     dining visible past the sofa) but Kontext still injected a wall
     behind the seating. Root cause: the OPEN-PLAN directive in
     `lib/kontextPrompt.ts` was AFTER the doorway / windows
     directives, so Kontext gave it lower weight; and the
     doorway directive's "show ONLY hallway, wall, void" framing
     gave the model permission to close off the open continuation as
     a "wall". Fix: moved OPEN-PLAN to position 1 in
     `roomFactsToArchitecturalPreserves`, rewrote with positive
     framing ("the kitchen/dining/hallway visible at the back of
     image 1 MUST remain visible") in addition to the existing
     FORBIDDEN list, and made the doorway directive
     conditional on the room being CLOSED-plan (skipped entirely
     when `open_plan_zones.length > 0`).
  2. **Auto-stage observability.** Audit confirmed #82's auto-stage
     hook had not run on any render today (no `multi_staged`
     revisions and no `staged_images` rows for renders that post-date
     the #82 deploy). Vercel function logs aren't easily accessible
     from CLI so the failure mode is invisible. Migration
     `20260522220000_renders_auto_stage_status.sql` adds two columns
     to renders: `auto_stage_status text` (null | started |
     completed | failed | skipped) and `auto_stage_error text`
     (reason / truncated error message). `lib/auto-stage.ts` now
     returns a structured `AutoStageResult { outcome, staged,
     skipped, reason }` and `/api/renders/[id]/status` writes
     'started' eagerly before the call (so timeouts leave a trace)
     then the final outcome after. Defensive: if the migration
     hasn't been applied, the column-write fails gracefully and the
     picking-list flow is unaffected.
  Next render will write to these columns; we'll see in the DB
  whether auto-stage ran and where it failed.
- `2026-05-22` — **#164 shipped — coerce legacy accounts to set
  preferences before dismissing the modal.** Audit found 4 of 6
  closed-beta accounts had `preferences IS NULL` (created before
  #153 shipped, never onboarded). Their renders were
  preference-blind: #156 ranker no-op, #163 fallback only hit the
  wishlist half. "Skip for now" removed from the first-time
  `PreferencesModal`. Backdrop dismiss + Esc already disabled in
  first-time mode, so legacy accounts now must pick ≥ 1 tag to
  proceed. Edit mode (preferences already set) keeps the Cancel
  button — saved users opening prefs to look aren't trapped.
  Closed-beta-scoped coercion; comment in modal file flags the
  decision point for when public signups open.
- `2026-05-22` — **#163 shipped — never-empty Complete-the-Look
  carousels.** Post-render shopping carousels (the per-category grids
  alongside the hotspot picking list) used to filter out categories
  with zero palette+room+style matches — so heritage palettes (#162)
  or thin categories like curtains showed gaps. Added a user-signal
  fallback tier on top of the existing 3-tier filter: products the
  user has wishlisted in that category, plus catalogue rows ranked by
  the prefs-vision-fit scorer (#156) against current
  `users.preferences.tags`. Tiers 1-3 also tightened to drop into the
  fallback as soon as palette coverage is below `perCategory` (vs
  half-filling). Empty-category drop at the end of
  `fetchCompleteTheLook` removed — every category in
  `ROOM_CATEGORY_MANIFEST[room_type]` is now in the response with a
  `source: 'palette' | 'mixed' | 'user_signal' | 'empty'` provenance
  for future UI labelling. Carousels always have a story regardless
  of palette coverage. Wires: `/renders/[id]/page.tsx` now loads
  `users.preferences.tags` and passes it + `user.id` to the fetch.
- `2026-05-22` — **Catalogue coverage audit + #162 memoed: heritage
  retailer scrapers.** After the morning's vision_profile rebuild
  (1,391 products rescored against all 56 palettes, palette_tags
  re-derived in lock-step), an audit confirmed 0 palettes have zero
  total product coverage but 14 sit under 50 total products — all
  heritage / period leaning palettes added in `ef147c6` / `ade2461`
  (victorian-refined, bauhaus-primary, french-provincial, cottage-
  english, forest-green-classic, etc). 17 of 56 palettes have zero
  sofas; same heritage cluster. Root cause: the scraper roster is
  modern / contemporary biased (Globewest, Koala, Freedom, MCM House,
  Coco Republic). #162 memos the next step — scrape 3-4 heritage-
  leaning AU retailers (Provincial Home Living, Domayne, Fenton &
  Fenton, an antique specialist) so the heritage palettes have real
  catalogue rows to anchor renders. Until then the heritage palettes
  remain shippable but will render with substitute pieces drawn
  from neutral / warm-grounded-earth overlap.
- `2026-05-22` — **#82 shipped — auto-stage every detected item on
  every render.** Closes the catalog-to-render fidelity gap so users
  see actual SKU pixels in the rendered scene by default, not Flux's
  generic interpretation of "boucle sofa". New module
  `apps/web/lib/auto-stage.ts` hooks into the `after()` block in
  `/api/renders/[id]/status` right after the picking list flips to
  'ready'. For every detected non-paint item with a top match that
  has a `productId` + `imageUrl`, builds a `MultiStageItem` and
  calls the existing `stageMultipleProducts()` pipeline (background-
  remove via birefnet → composite → Flux Kontext harmonise). Caps
  at 4 items, persists as a new `multi_staged` revision so the
  user sees the staged composite as the canonical view but can
  revert to base render via the revision strip in one click. Label
  `+ N products (auto)` differentiates from user-initiated
  multi-stages. Failures swallowed — base render + picking list
  still succeed. Kill-switch: `AUTO_STAGE_ALL=false`. Renders now
  show real product imagery by default, ~20-30s after the picking
  list lands (progressive enhancement layered on top of the
  existing pipeline; no breaking changes).
- `2026-05-22` — **§6.12 memoed: Personalised product universe
  (per-user curated catalogue) + tasks #158-#161.** Builds on #156:
  every product now carries `vision_profile` and every user carries
  `preferences.tags`, both projectable into the same signal space.
  The intersection IS the user's catalogue — a materialised subset of
  the 2,500+ row product table that fits their declared taste,
  computed independently of any room photo. Two surfaces from one
  derivation: (1) a new dashboard "Your edit" personalised browse
  view that doesn't need a room upload, (2) smaller candidate pool
  feeding the render-time matcher → cheaper Sonnet curation, faster
  renders, more honest "for you" framing. Phased: #158
  on-the-fly affinity endpoint, #159 dashboard surface, #160
  materialise + plug into /api/render candidate query, #161
  cache invalidation + cron freshness. Same commit renumbers the
  §6.11 planned "Phase D" from #156 to #157 — the integer was
  reused by the shipped pre-filter PR.
- `2026-05-22` — **#156 prefs ↔ vision_profile pre-filter shipped.**
  Closes the architectural gap where `users.preferences.tags` only
  shaped the *Claude designer's prompt* (recommend + curation) but
  never narrowed the *candidate product pool*. The fallback metadata
  path (`autoFeatureForPalette`) was completely prefs-blind, and even
  the Claude-curated path sent a candidate set ordered by price only
  — meaning a user who picked "avoid:cool-metals" could still see a
  chrome floor lamp in the prompt if the palette happened to match.
  - New module `apps/web/lib/prefs-vision-fit.ts` with a deterministic
    slug → vision_profile signal map (positives + negatives) built
    against the exact `BRIEF_TAG_GROUPS` taxonomy and the exact
    `materials` / `color_family` / `visual_tone` / `quality_tier`
    enum vocabularies the scraper's `visionProfile.js` writes.
    Weights: materials direct hit +2, mood→tone +1, colour/tier +1,
    avoid axis hit −3. Threshold: score < −2 → drop (one unmitigated
    avoid).
  - `lib/featuring.ts` — both `autoFeatureClaude` (per-bucket re-rank
    before the Claude prompt) and `autoFeatureForPalette` (re-rank
    before the per-category dedupe) now run the new ranker. SQL
    selects pull `vision_profile` alongside the existing columns. A
    log line surfaces the dropped / top-score numbers per render so
    we can verify the filter is biting.
  - `app/api/render/route.ts` — when no project context exists, the
    render route now falls back to `users.preferences.tags` for the
    brief tags (closes the latent #155 gap where outside-project
    uploads silently shipped with empty briefTags even when the user
    had set canonical preferences). Snapshot semantics intact —
    read-only on `users.preferences`.
  Net: products with explicit avoid-conflict materials/tone/colour
  get dropped from the candidate pool *before* Claude ever sees them;
  preferred materials float to the top of each bucket; the no-Claude
  fallback also respects preferences for the first time. Catalogue
  rows without a `vision_profile` yet (pre-#145 backfill or new
  arrivals) score neutral and rank alongside un-preferred candidates
  — graceful degradation rather than a hard dependency.
- `2026-05-22` — **#149 step 1 shipped — drop cardinal direction
  from vision schema.** The c6f8137 hot-fix scrubbed cardinal
  direction from the render-side prompts but `lib/vision.ts` was
  still asking Claude for `"direction": "north" | "south" | "east"
  | "west" | ...` in the analyseRoom schema — and consumers
  (`lib/featuring.ts`, `lib/brief/synthesiser.ts`,
  `components/rooms/upload-form.tsx` DesignerSummaryCard) were still
  printing "south-facing" in matcher prompts, brief prompts, and the
  user-facing room read. The schema-level fix:
  - `lib/vision.ts` — `direction` removed from the JSON schema in the
    system prompt + an explicit LIGHT directive added: "Do NOT
    estimate cardinal compass direction. You cannot infer compass
    orientation from a 2D photo without metadata; guessing produced
    hallucinated windows downstream." TS type keeps `direction?` as
    optional so cached `rooms.analysis` blobs from before the fix
    still parse without crashing — new analyses just never return it.
  - `lib/featuring.ts` + `lib/brief/synthesiser.ts` — `light:` line
    now surfaces `quality` only, no cardinal segment.
  - `components/rooms/upload-form.tsx` — DesignerSummaryCard room-read
    line drops the `direction`-branch entirely; uses `light.quality`
    only (so cached blobs with stale cardinal data don't surface
    "south-facing" either).
  Still deferred on #149: image-space `light.source` ("from left" /
  "from right" / "from above" / "indirect") and `window_walls: string[]`
  per the §6.10 plan — both are enhancements, not bug fixes. The
  band-aid + this schema fix together close the window-hallucination
  class without needing sensor data; #150/#151 RoomPlan integration
  remains the long-term direction.
- `2026-05-22` — **Dashboard preferences nested into HeroGreeting
  welcome copy.** Replaced the standalone PreferencesSection block
  (visible dedicated row right under the greeting, intro from #153)
  with an inline chip row + Edit pill nested at the end of
  HeroGreeting's welcome copy. First-time users see a "Set up your
  taste signal →" cognac pill that auto-opens the PreferencesModal;
  returning users see a "Your taste:" eyebrow + up to 6 chips (with
  "+N more" overflow) + an "Edit →" pill. The PreferencesModal mount
  moved into HeroGreeting; the first-time auto-open flow is preserved
  and snapshot semantics from #153/#154/#155 are unchanged — the
  modal still PUTs to /api/preferences from the dashboard surface and
  only that surface. Net effect: dashboard hero stays compact on
  mobile while surfacing the taste signal at the point of greeting
  rather than as a separate "system" panel. Files:
  `components/dashboard/hero-greeting.tsx` (chips + modal),
  `app/dashboard/page.tsx` (drop PreferencesSection import + mount),
  `components/dashboard/preferences-modal.tsx` (comment refresh).
  Dead file deleted: `components/dashboard/sections/preferences-section.tsx`.
- `2026-05-22` — **Single native-picker upload UI for /rooms/new
  Step 01.** The room-photo upload affordance went from a two-button
  "Browse files / Use camera" split + a desktop `getUserMedia`
  live-viewfinder modal to a single tap target that opens the OS
  file sheet (Take Photo + Photo Library + Choose File on iOS /
  Android, Finder on desktop). Dropped the `capture="environment"`
  second input plus the `videoRef` / `streamRef` / `cameraOpen`
  bespoke camera UI — the native sheet is faster, more accessible,
  and respects the user's default camera/photos apps. Drag-and-drop
  on desktop preserved; preview replaces in-place with a "Replace
  photo" pill in the corner; HEIC pipeline (`prepareImageForUpload`)
  + 15 MB cap untouched. Net −56 lines in
  `components/rooms/upload-form.tsx`. Vision-board upload
  (`board-image-upload.tsx`) already uses the native-picker pattern
  via a button trigger; visual parity with the new graphic-tile
  pattern is a separate decision.
- `2026-05-22` — **#155 §6.11 Phase C shipped: outside-project uploads
  inherit user preferences + per-render override.** Closes the
  cold-start gap that started the whole §6.11 conversation. Three
  changes:
  1. `apps/web/app/api/recommend/route.ts` resolves the brief tags
     fed to `synthesiseBrief()` by strict priority: per-render
     override (this request body) → project brief (when projectId
     supplied) → `users.preferences.tags` → []. Returns the chosen
     `source` ('override' | 'project' | 'user_prefs' | 'none') and
     the `appliedTags` so the client can render the right banner
     and pre-populate the override modal.
  2. `apps/web/components/dashboard/preferences-modal.tsx` gains a
     `persistMode: 'canonical' | 'per-render'` prop. In per-render
     mode the modal skips the PUT to /api/preferences and instead
     hands the tags back via `onSaveOverride(tags)` — the canonical
     prefs stay untouched. Different header copy + button label
     reinforce "this is for this image only".
  3. `apps/web/components/rooms/upload-form.tsx` adds the
     RecommendationSourceBanner above the carousels — eyebrow
     ("Using your preferences" / "Using your project brief" /
     "Customised for this image"), explainer copy, the applied tag
     chips, and a "Customise →" CTA that opens the modal in
     per-render mode. When the user is on an override, a "Reset"
     button reverts back to inherited prefs/project tags by re-firing
     `/api/recommend` without `overrideTags`.
  Snapshot semantics strictly enforced: per-render override lives in
  React state only, never persisted anywhere. The only way to update
  canonical prefs is the dashboard edit surface (Phase A).
- `2026-05-22` — **#154 §6.11 Phase B shipped: project wizard inherits
  user preferences.** New projects now snapshot `users.preferences.tags`
  into `projects.brief.tags` at create time, with an
  `inherited_from_user_prefs: true` marker on the brief. The wizard's
  BriefPicker renders a "Pre-filled from your preferences — adjust if
  this project is different" banner when that marker is present and
  the user hasn't yet toggled anything; the banner hides as soon as
  any chip is touched. Snapshot semantics enforced: subsequent
  `POST /api/projects/[id]/brief` calls replace the whole brief shape
  (existing behaviour), so the marker is naturally stripped after the
  first save. Changes to `users.preferences` on the dashboard never
  cascade into already-created projects — each project carries its
  own copy from the moment it's born.
  Files: `apps/web/app/api/projects/route.ts` (read prefs + snapshot
  into the insert), `apps/web/app/projects/[id]/page.tsx` (read
  the flag from `project.brief.inherited_from_user_prefs`),
  `apps/web/components/projects/project-wizard.tsx` (pass through),
  `apps/web/components/projects/brief-picker.tsx` (banner + edit-
  detection). When a project is seeded from a vision board, the
  user-pref tags overlay on the board's other signals
  (palette_signal, style_signal, trend_signals, product_anchors)
  rather than replacing them.
- `2026-05-22` — **#153 §6.11 Phase A shipped: user preferences
  storage + onboarding + dashboard editor.** Closes the cold-start
  gap when users upload a photo outside a project — previously
  /api/analyse-room had zero user context, so Claude's room
  recommendation was based on the photo alone. Now there's a
  canonical user-level taste signal at `users.preferences jsonb`,
  inherited by project briefs and outside-project uploads via
  strict snapshot semantics (changes never cascade upward except
  via explicit edits on the dashboard). Three pieces shipped:
  1. Migration `20260522190000_users_preferences.sql` — `jsonb`
     column on `public.users`. Read/write covered by existing RLS.
  2. API `GET/PUT /api/preferences` — only the authenticated user
     can read/write their own row. Body is `{ tags: string[] }`;
     server de-dups, sorts, stamps `updated_at`.
  3. UI:
     - `PreferencesModal` (`components/dashboard/preferences-modal.tsx`)
       — chip-picker over `BRIEF_TAG_GROUPS` (same taxonomy as the
       project wizard, so vocab stays consistent). Two modes: first-
       time (forced-open, no backdrop dismiss, "Skip for now"
       allowed) and edit (standard modal UX).
     - `PreferencesSection`
       (`components/dashboard/sections/preferences-section.tsx`) —
       dashboard surface. Option A placement: visible dedicated row
       right below `HeroGreeting`, above featured products. Shows
       current chips with "Edit →"; auto-opens the modal on first
       visit when `preferences IS NULL`.
     - `dashboard/page.tsx` extends the existing `profile` query to
       pull preferences (no extra round-trip) and renders the section.
  Inheritance into project briefs (#154 Phase B) and outside-project
  uploads (#155 Phase C) is the next two phases — wiring exists, the
  reads just haven't moved over yet. Foundation only in this PR.
- `2026-05-22` — **#148 vision-grounded tag re-derivation shipped
  (catalogue intelligence Phase 4).** Now that vision_profile coverage
  hit 99.1% on imageable rows (1,387 of 1,400), the §6.9 sequencing
  gate is open and the four tag columns flip from ΔE76-derived to
  vision-derived for any row that has a vision_profile.
  - New shared util `apps/scraper/utils/visionTags.js` —
    `tagsFromVisionProfile(profile, category)` returns
    `{ palette_tags, room_tags, style_tags, mood_tags }`.
    `palette_tags` = palette_fit keys ≥ 0.4; `room_tags` = room_fit
    keys ≥ 0.4 (vision-grounded, not the palette-union shortcut
    deriveTags would give); `style_tags` + `mood_tags` come from
    `productTags.deriveTags()` with the vision-grounded palette set
    (palette-union is correct for style/mood — those are properties
    of the palette family, not the individual product).
  - New one-shot script `apps/scraper/scripts/redeRiveTagsFromVisionProfile.js`
    iterates products WHERE `vision_profile IS NOT NULL`, applies the
    derivation, writes the four columns. Idempotent (skips rows where
    the derived shape already matches). Standard `--dry`, `--limit`,
    `--retailer` flags. Invoke via
    `pnpm --filter @myhome/scraper run redrive-tags`.
  - `visionProfile.js` extended so the same UPDATE that writes
    `vision_profile` for new rows also writes the four derived tag
    columns — the catalogue stays in lock-step going forward.
  - `ingest.js` deliberately unchanged: paint products and any other
    imageless rows keep their ingest-derived ΔE76 tags (vision wins
    where it can, ΔE76 stays as the floor). Soft divergence from the
    original §6.9 #148 memo, which proposed dropping tag-writing at
    ingest entirely — that would have left paint products with empty
    tag arrays. Documented in the #148 entry now.
- `2026-05-22` — **§6.10 memoed: Sensor fusion (room scan + vision)
  + tasks #149-#152.** The window-hallucination class of bugs has a
  structural cause — Claude vision is guessing 3D geometry from 2D
  pixels when modern phones can supply that ground truth natively
  (Apple RoomPlan, ARKit). §6.10 lays out the phased path: (#149)
  vision.ts schema cleanup to drop cardinal direction + add image-
  space light source + window_walls list — no sensor required, the
  proper version of the May-22 hot-fix; (#150) native iOS or
  Capacitor wrapper with RoomPlan; (#151) sensor fusion reconciliation
  logic in /api/analyse-room — trust LiDAR for geometry, Claude for
  style/materials; (#152) optional Android ARCore plane-detection
  fallback. Real native engineering — measured in weeks. Right call
  after closed-beta proves rendering quality + conversion; memoed
  now so the option stays visible while §6.9 catalogue-intelligence
  work is priority. Cross-references the c6f8137 hot-fix as the
  prompt-layer band-aid that holds while this proper architecture
  is built.
- `2026-05-22` — **Window-hallucination fix in render prompts.** User
  reported renders adding windows on walls that didn't have one in the
  original photo. Root cause: vision.ts asks Claude for cardinal
  light direction ("north" / "south" / "east" / "west") but Claude has
  no way to determine true compass orientation from a single photo
  (no compass, no geo metadata) — it's guessing from shadow length +
  light colour temperature, often wrong. That guess fed straight into
  the Flux prompt via `lib/styles.ts` as "maintain north-facing light
  direction", which Flux interpreted by inventing a window on the
  wall it associates with north — hallucinating openings where the
  original had closed walls. Fix:
  (a) `lib/styles.ts` — drop the cardinal-direction preserve directive
     entirely. Pass `light.quality` (warm/cool/diffuse/direct) when
     available, plus an explicit "do NOT add new windows / glazed
     openings / wall apertures" forbidden clause.
  (b) `lib/kontextPrompt.ts` — the window-preservation directive now
     fires unconditionally (was: only when `light.notes` was set,
     leaving the sampler unconstrained when Claude didn't volunteer a
     window note). FORBIDDEN list extended from "no style change" to
     "no NEW openings on walls that show closed walls in image 1".
  Brief synthesiser + featuring still format `light.direction` into
  their Claude prompts — lower impact (product recommendations, not
  renders) but worth cleaning up in a follow-up. The proper fix is to
  change the vision.ts schema to image-space light source ("from
  left", "from above") + explicit window-walls list, deferred to a
  separate ticket so this hot-fix can ship today.
- `2026-05-22` — **#148 memoed: vision_profile becomes the source of
  truth, old tag columns become projections (catalogue intelligence
  Phase 4).** Spec for flipping the data ownership so `palette_tags`
  / `style_tags` / `room_tags` / `mood_tags` are *derived* from
  `vision_profile` rather than from ΔE76 colour-distance + palette
  membership inheritance. Same column names, smarter data underneath
  — featured-curation and any other consumer keeps reading without
  changes. ΔE76 stays in the ingest path but only as the junk-photo
  gate, not as a tag producer. Sequencing: don't flip until
  vision_profile coverage is >~95% in production (running the #145
  backfill now). Tracked in §6.9 as #148.
- `2026-05-22` — **#147 vision_profile-aware matcher (catalogue
  intelligence Phase 3).** Closes the catalogue intelligence bundle.
  `fetchCandidates()` now has a three-tier fall-through: (1) new
  `match_products_by_vision_profile` RPC narrows by what Claude saw in
  the #145 pre-pass (palette_fit + room_fit >= 0.6) and pgvector
  cosine-sorts; (2) `match_products_filtered` from #146 (palette_tags
  + room_tags filter) takes over when vision_profile coverage is thin;
  (3) legacy non-RPC palette+room+price-desc filter as the last resort.
  Both RPC tiers reuse the same crop embedding — one CLIP call per
  box, two cheap pgvector queries. The deploy is inert on vision_profile
  until the visionProfile.js backfill runs (#145) — Tier 1 returns 0
  rows from `WHERE vision_profile IS NOT NULL` and Tier 2 takes over,
  preserving #146 behaviour. Once the backfill is run, Tier 1 starts
  surfacing rows and the matcher's pre-filter becomes grounded in
  per-image Claude judgement rather than inherited tags.
  *Deferred follow-ups from the §6.9 spec:* (a) drop CANDIDATES_PER_ITEM
  from 5 → 3 — kept at 5 because the spec gates this on an A/B eval and
  the existing UX shows 5 cards per box; (b) run the formal A/B eval vs
  the pre-#146 matcher — separate ticket once vision_profile coverage
  is non-trivial in production.
- `2026-05-22` — **#146 CLIP pre-rank in matcher (catalogue intelligence
  Phase 2).** Brings CLIP back into the matcher as a pre-rank filter
  (not as the final ranker, which is where it lost us last time).
  Render-time flow: for each detected bounding box, embed the crop
  once via `@/lib/embeddings` (HF Inference on Vercel, LOCAL onnxruntime
  in dev — both produce the same 512-dim ViT-B/32 vector that the
  catalogue rows were embedded with offline by `embed.js`) and call
  the new `match_products_filtered` RPC (migration 20260522170000).
  The RPC narrows by category list + palette_tags membership + room_tags
  overlap and sorts by HNSW cosine distance, returning the top
  CANDIDATES_PER_ITEM visually-similar candidates. Those feed the
  Claude Haiku ranker as before. On any failure (no HF_TOKEN, HF
  outage, embedding error, RPC empty) `fetchCandidates()` gracefully
  falls back to the legacy palette_tags + room_tags + price-desc path,
  so the matcher never starves on a flaky upstream. Quality win is
  immediate (candidates are visually-similar instead of price-sorted);
  latency win compounds with #147 when the Claude ranker shrinks.
  Catalogue embedding backfill is via the existing
  `pnpm --filter @myhome/scraper run embed` — coverage matters: if
  embeddings are thin in production the RPC returns few rows and the
  fallback path takes over. Run `embed` to fill any gaps.
- `2026-05-22` — **#145 vision_profile foundation shipped (catalogue
  intelligence bundle Phase 1).** New `vision_profile jsonb` column on
  `products` (migration 20260522160000) + a new scraper script
  `apps/scraper/scripts/visionProfile.js` that calls Claude Haiku per
  product image and returns a structured fit signal: silhouette,
  materials, color_family, visual_tone, quality_tier, plus per-palette
  fit and per-room fit scores in [0, 1] (≥0.4 threshold for inclusion;
  others implicit 0). System prompt includes a compact one-line
  descriptor of all 56 palettes; cache_control:ephemeral on the system
  block amortises that cost across the run via Anthropic prompt-cache.
  Resumable (skips rows that already have a profile unless --rebuild),
  retailer-scopable, --dry / --limit flags. Backfill not yet run —
  catalogue-wide pass is ~$15-30 at Haiku pricing; user gates the
  spend. Matcher (#147) still uses palette_tags; vision_profile is
  inert until #147 lands.
- `2026-05-22` — **Roadmap: catalogue intelligence bundle memoed
  (§6.9, tasks #145 + #146 + #147).** Spec for pre-computing per-
  product visual + style fit so the render-time matcher does less
  work, faster. Three sequenced tasks: vision-grounded
  `vision_profile` on every product (#145), CLIP embedding backfill
  + pgvector pre-rank in `matching.ts` (#146), and matcher refactor
  to consume `vision_profile` + drop the Claude ranker candidate
  count (#147). Targets the ~10–15s render-time Claude Haiku ranker
  tail, with the goal of dropping it to ~3–5s while making picks
  more on-brief. Cross-references the deferred room-side
  vision→matcher bundle memo so the prompt-engineering work can be
  amortised across both ends. (Draft was prepared in a prior session
  using task IDs #140–#142; renumbered to #145–#147 on port since
  those original IDs landed on shipped work — HEIC helper, dashboard
  stock photos, rooms room-grounded recommendation.)
- `2026-05-22` — **60s Vercel timeout fix on Claude-vision routes (project
  analyse + vision-board upload).** A user hit a 60s function timeout on
  /api/projects/[id]/analyse with a small bathroom image. Root cause:
  Anthropic SDK calls had no per-call timeout (SDK default is 600s) so
  any single hung call could burn the entire 60s function budget, and
  the default retry schedule [0/3s/8s/15s] reserved 26s for backoff
  delays alone. The project-analyse route chains two Claude calls
  sequentially (analyseRoom + synthesiseBrief), compounding the risk.
  Same bug pattern in vision-board upload (single Sonnet 4.6 identify
  call) so both were patched together. Changes: (1) lib/vision.ts —
  analyseRoom gets timeout=25_000 + delaysMs=[0,2s,5s], stale comment
  about "3 attempts at 0/2s/5s" corrected; (2) lib/brief/synthesiser.ts —
  synthesiseBrief gets timeout=30_000 + delaysMs=[0,2s,5s];
  (3) lib/vision-board-image-match.ts — identifyImage gets timeout=30_000
  + delaysMs=[0,2s,5s]; (4) /api/projects/[id]/analyse and /api/vision-
  boards/[id]/upload now log [project-analyse] / [vision-board-upload]
  timing breakdowns (download / vision / synth / total) so the next
  failure tells us which stage ate the budget. Typical wall-clock after
  fix: ~20-25s on the project analyse route (was unbounded).
- `2026-05-22` — **Render page IA — extended set inline expansion
  (Phase 3 of 3).** Closes the carousels-first rework. Each
  `<CategoryCarousel>` now exposes a "See more {category}" affordance
  that fetches a deeper palette+room+style filtered set via
  `GET /api/renders/[id]/extended/[category]` and renders it as a
  responsive grid (2-cols mobile, 3 desktop, 4 wide) below the
  carousel row. Toggle to collapse. State is per-carousel so the
  page only pays the fetch cost for categories the user actually
  digs into, and the wishlist hearts share state across visible
  and extended cards in the same component. New
  `fetchExtendedCategory` helper in `lib/completeTheLook.ts` reuses
  the existing 3-tier filter logic (palette+room+style →
  palette+room → category+room) with `offset`/`limit` so the
  extended set skips the products already on screen and tops out
  at 24 per category (60 max via the route guard). New route
  `app/api/renders/[id]/extended/[category]/route.ts`: auth-gated,
  scope-validates the render, resolves palette + style + room from
  the render row exactly like the status route does, returns
  `{ category, offset, limit, products }`. Closes the rework
  initiated with the products-first vision directive — the page
  now serves an excited designer commentary, primary carousels by
  category, hotspot scroll-linkage, AND extended browse depth, all
  without leaving the render page.
- `2026-05-22` — **Render page IA — carousels-first + hotspot scroll
  linkage (Phase 2 of 3).** `<CompleteTheLook>` converted from a
  3-col grid to horizontal-scroll carousels per category — each
  card is fixed-width, the row scrolls with native momentum, mobile-
  first. Section heading retoned to "Shop by category" from
  "Complete the look" since carousels are now the primary shopping
  surface rather than supplementary picks. Every carousel gets an
  `id="cat-{slug}"` anchor via the new exported `slugifyCategory`
  helper. `<ShoppableRender>` now accepts a `categories` prop and
  renders the carousels INSIDE itself — between the designer
  commentary slot and the legacy `<PickingListPanel>` — so the order
  on /renders/[id] is now: image+hotspots → designer commentary →
  shop-by-category carousels → hotspot picking list (secondary).
  Hotspot click handler updated to scroll to the matching carousel
  first (slugifies the hotspot's category and seeks `#cat-{slug}`),
  falling back to the legacy `pl-item-${idx}` element when no
  matching carousel exists. The standalone `<CompleteTheLook>`
  section that used to live below `<RevisionStrip>` on the page is
  removed — same component, just rendered inside ShoppableRender
  now. Phase 3 (extended-set inline expansion per carousel) ships
  next.
- `2026-05-22` — **Designer tone rewrite — products-first, no critique
  (Phase 1 of 3 for the render-page IA rework).** Per the owner
  directive that vision/designer/Kontext output should all serve the
  picking list, not critique the upload, the designer SYSTEM prompt
  in `lib/prompts/designer-system.md` was rewritten end-to-end:
  excited tone, leads with what's in the render, names products and
  palette tones explicitly, ends with a "I've pulled together my
  go-to's — keep scrolling for more by category" curated invite.
  Output shape collapsed from five sections (designerRead +
  recommendations + compositionNote + watchOutFor + nextStep) to
  three (designerRead + paletteStory + exploreInvite) — the
  per-product reasoning is now redundant because the category
  carousels render the products directly, and the critique sections
  ("watch out for") are exactly what the owner asked to retire.
  `DesignerAdvice` type, parser, and `<DesignerRead>` component all
  updated. Old-shape rows still parse via backwards-compat fields on
  the interface. Removed the "Claude Sonnet reads your room photo
  and the palette you picked, then writes a designer's-eye critique"
  description from the component header — the commentary now speaks
  for itself. Phase 2 (carousels-first IA + hotspot→carousel scroll
  linkage) and Phase 3 (extended-set inline expansion) ship next.
- `2026-05-22` — **Depth/perspective preservation directive in
  Kontext.** Surfaced by a real user render: after the open-plan
  fix the same photo came back preserving the layout but with the
  room's depth compressed/telescoped toward the camera. Same
  failure family as the open-plan back wall — Kontext has
  composition priors and reshapes pixels to match them when
  nothing in the prompt anchors the geometry. Fix: a new directive
  in `roomFactsToArchitecturalPreserves` that consumes the
  already-captured `dimensions_approximate_m: { width, depth, height }`
  field from `RoomAnalysis` (vision populates this when confident).
  When width or depth is non-null, the prompt now names the
  approximate proportions and emits a FORBIDDEN list against
  compressing depth, narrowing the room, moving the far wall
  closer, or telescoping the view. Skipped entirely when both
  dims are null. The metric numbers don't need to be exact — the
  ratio + explicit anti-compression ban is what bites. No schema
  change, no migration; pure prompt-builder logic.
- `2026-05-22` — **Vision SYSTEM prompt reframed as products-first.**
  Owner-directive change: the platform's primary purpose is steering
  the user toward a confident shopping list, not producing a pretty
  render. The vision prompt was opening with *"You are a room-analysis
  vision model… describing what is actually in the photo so a designer
  LLM can make recommendations"* — framing vision as a descriptive
  input to a different system. Reframed to *"You are the first step
  in myMaison's product recommendation engine… steer the user toward
  a confident shopping list of pieces to buy. The render that follows
  is the visual hook; the picking list of products is the deliverable."*
  No schema change, no downstream coupling — just a free framing
  nudge that biases Claude's analysis toward purchase-relevant
  observations. Connected follow-up (deferred): `purchase_opportunities`
  + `replacement_hint` fields on RoomAnalysis with matcher consumption
  — memo'd to memory rather than shipped piecemeal since the fields
  are wasted tokens without matcher wiring.
- `2026-05-22` — **Open-plan layout signal end-to-end.** Surfaced by
  a real user render: large open-plan living + dining + kitchen photo
  came back with an invented back wall behind the couch and windows
  invented on both sides. Root cause — closed-plan rooms dominate
  Kontext's training data, and our vision schema had no way to flag
  "this space continues into other zones." Two changes: (1)
  `RoomAnalysis` gains `open_plan_zones?: string[]` with the vision
  SYSTEM prompt updated to look for + name additional functional
  zones visible in the photo (dining behind couch, kitchen to the
  right, hallway past the bed, mezzanine void), recording each as
  a short phrase. Empty array for closed-plan rooms. Field is
  optional in the type so older cached analyses still typecheck.
  (2) `roomFactsToArchitecturalPreserves` in lib/kontextPrompt.ts
  consumes the field — when populated it emits a hard FORBIDDEN
  directive listing the zones verbatim and explicitly banning back
  walls, partitions, dividers, and windows where the space
  continues. Closed-plan renders are unaffected (empty zones skips
  the directive entirely).
- `2026-05-22` — **Supabase migrations automated on push to main.**
  New `.github/workflows/supabase-push.yml` runs `supabase db push
  --include-all` whenever main changes any file under
  `supabase/migrations/`. Closes a workflow gap that built up after
  multiple recent features (#139a, #139b, #140, #141, plus the
  picking_list_status migration) shipped code to Vercel but left
  their schema migrations un-applied to the linked Supabase project,
  causing PostgREST 4xx on the new columns. Concurrency-locked so
  two pushes don't race; pinned to Supabase CLI 2.x; needs three
  repo secrets (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
  SUPABASE_DB_PASSWORD). Manual re-trigger via workflow_dispatch.
- `2026-05-22` — **Two-stage render completion + tightened picking list.**
  The architectural fix for "renders feel slow." Pre-change the user
  saw nothing for ~60-90s then everything arrived at once because
  /api/renders/[id]/status blocked one poll response on image-save +
  the 30-50s matching pipeline. New model: foreground saves the fal
  image and flips `status='succeeded'` + new `picking_list_status='building'`
  in ~5s; matching runs via `after()` and writes
  `picking_list_status='ready'` when done. Migration
  `20260522150000_renders_picking_list_status.sql` adds the column
  (backfilled 'ready' for existing rows with a picking list,
  'not_started' otherwise) plus a CHECK constraint on the four
  states. RenderPoll now tracks BOTH terminal axes and calls
  `router.refresh()` on each transition — image lands at ~T+30, list
  populates at ~T+60. A small "Finding matching products…" chip
  shows in the heading row while building. TTL guard: if
  picking_list_status sits in 'building' for >120s the next poll
  marks it 'failed' so the user isn't stuck. Status route
  maxDuration bumped 60→120 so the after() worker has headroom.
  Same change tightens the picking-list pipeline itself:
  MAX_ITEMS 12→8, CANDIDATES_PER_ITEM 8→5, validate pass disabled
  (ENABLE_VALIDATE=false; flip back to true if Florence-2 starts
  mislabelling architecture as objects). Combined: user perceives
  the render at ~30s instead of ~75s, with the list assembling
  visibly over the next 25-35s — competitive with Midjourney-class
  UX on the first impression. Frontend is forward-compatible: page
  loads cleanly pre-migration (picking_list_status fetched in a
  separate maybeSingle() query that tolerates missing column).
- `2026-05-22` — **Migrations run automatically on deploy.** Removed
  manual `supabase db push` instructions from §7.4 and §6.8 recently-
  shipped notes. Commit the migration file; deploy handles the rest.
- `2026-05-22` — **Palette likes — aggregate-popular carousel + like toggle.**
  Users can now heart any palette on the dashboard carousel or /palettes
  page. Likes are persisted in a new `palette_likes` table (user_id,
  palette_id, RLS: authenticated read / insert-delete own). The dashboard
  carousel is now composed server-side from the top-18 most-liked palettes
  (aggregate across all users) ∪ the current user's liked palettes, ordered
  lightest→darkest by perceptual wall-colour luminance (paletteBrightness()
  IEC 61966-2-1). Cold-start fallback: when the table is empty the
  editorial `popular` tag seeds the carousel. /palettes page gains a
  dynamic "Your likes" filter chip (hidden when 0) and a DB-driven
  "Popular" chip. New API route: POST /api/palettes/[paletteId]/like.
  New component: PaletteLikeButton (compact/comfortable variants,
  optimistic UI with server reconciliation). Casts via (supabase as any)
  until next gen-types run.
- `2026-05-22` — **Palette catalogue expansion + featured/all split.**
  Grew the palette set from 16 to 56 — 40 new entries covering the
  modern-neutral / natural-light / popular-tone gaps the original
  catalogue missed (warm whites, greige, mushroom, oat, limewash
  plaster, bone & black, chocolate brown, slate blue, navy, japandi,
  wabi-sabi, modern Mediterranean, plus heritage frameworks like
  Art Deco, French provincial, Victorian). Each palette carries the
  full persona_fit + timelessness metadata so the brief synthesiser
  matches them like the existing ones. Introduced a `popular` tag
  (18 curated picks) that drives a featured/full split: the dashboard
  carousel surfaces only the popular subset (was: all 16), the wizard
  Step 3 carousel ① defaults to popular with a "Show all 56 →"
  toggle that always keeps Claude's recommendation + the current pick
  visible, and a new `/palettes` browse page lists everything with
  single-select filter chips by tag (popular / neutral / modern /
  natural / light / warm / cool / bold / heritage). Carousels ②/③
  in the wizard (2026 trends / Tried & tested) keep showing their
  full timelessness-bucketed sets — that's the user's explicit
  "browse all of one direction" path. Cherry-picked from the parallel
  `claude/wizardly-chandrasekhar-9ad928` worktree where the work was
  originally committed but never pushed; replaces the placeholder
  `/palettes` page shipped earlier today in `b0287fd`. The shared
  `components/palettes/palette-swatch-card.tsx` extraction from that
  earlier commit is preserved since 431c122 didn't touch it.
- `2026-05-22` — **Eval mirrors prod warmup + poll cadence.** The
  2026-05-22T00-39-18 eval surfaced a 42.7s Kontext inference time
  vs 24.7s the run before — same code, same fixture. Root cause was
  the eval was never firing /api/warm-equivalent pings, so it
  systematically measured cold-start latency real users don't see
  (prod fires warmup on /rooms/new mount and again on palette pick).
  Fix: new fireWarmup() helper at the top of runIteration replicates
  /api/warm's three pings (warmEmbeddings + fal florence-2 + fal
  flux-control-lora-canny) fire-and-forget, so by the time the
  iteration submits its real Kontext call the worker is hot. Also
  drops the eval's pollFal/pollKontext interval from 2000ms → 1000ms
  to match (and slightly beat) the prod render-poll 1500ms. Together
  these align eval wall-clock with what prod actually experiences.
- `2026-05-22` — **Render-path UX latency pass.** Two cheap wins on
  perceived render time. (1) RenderPoll interval 3000ms → 1500ms in
  components/renders/render-poll.tsx (MAX_POLLS bumped 80 → 160 to
  preserve the ~4 minute wall-clock budget); the render usually
  completes 0-3s before the user sees it because polling was the
  choke point at the end. (2) Warmup keepalive in
  components/rooms/upload-form.tsx — the existing on-mount POST to
  /api/warm only fired once, so a user who hesitated past the
  ~5-minute cache window between upload and submit hit a cold
  fal/Anthropic on render. Replaced with a paletteId-watching effect
  that re-fires whenever the user lands on a different palette
  (palette is typically the last decision before render). Both
  fire-and-forget; no quality risk.
- `2026-05-22` — **Matching pipeline: concurrency cap + retry on 429.**
  Pairs with the base64-candidates fix to fully close the matching
  failure modes the 2026-05-22T00-22-19 eval surfaced. Two structural
  changes in lib/matching.ts: (1) added settledWithConcurrency helper
  with Promise.allSettled semantics + a fixed concurrency cap, and
  swapped both fan-outs to use it — validate at 8 (cheap, ~600 tokens
  per call), rank at 4 (expensive, ~5400 tokens per call). Keeps
  steady-state under Haiku's 50K input-tokens/minute ceiling without
  serialising. (2) Wrapped both client.messages.create() calls in
  withAnthropicRetry (label 'matcher-validate' / 'matcher-rank') so
  the residual bursts that still bump the ceiling get backed off
  through the existing 0/3s/8s/15s schedule rather than silently
  dropping picking-list items. Net effect: predictable matching
  wall-clock (~15-25s instead of "happy path 8s, sad path 60s+
  timeout") and zero silent drops from 429s.
- `2026-05-22` — **Matching pipeline: candidate images inline base64.**
  Same playbook as the vision perf pass, applied to
  `rankWithClaude` in lib/matching.ts. The 2026-05-22T00-22-19 eval
  surfaced two silent failure modes on the picking-list build: a 400
  "Unable to download the file" when Anthropic couldn't reach one
  candidate's retailer-CDN image URL (which aborts the WHOLE call,
  not just that candidate), and a 429 rate-limit pressure from many
  parallel matching calls. The fix: hydrate each ProductRow's
  image_url to bytes via fetch() with a 5s timeout, filter unreachable
  candidates out of the list, and pass survivors to Claude as
  `source.type: 'base64'`. Two wins: Sydney→AU-retailer-CDN fetches
  are faster than US-edge→AU fetches, and one bad URL no longer
  poisons the whole call. The eval run silently dropped 2 picking-
  list items from 12 → 10 from this exact error class — base64 fixes
  it. Doesn't address the 429 rate-limit (that's the parallelism
  story, separate ticket).
- `2026-05-22` — **Render-path performance pass.** Two compounding
  wins to cut wall-clock without touching scores. (1) Fal input
  resize: the client-side upload form already caps at 1600 long-edge,
  but both flux-general and kontext-multi resample to ~1MP (1024 long-
  edge) internally — so ~60% of the bytes we hand fal are pure
  bandwidth waste on the fal-fetch step. Added resizeForFlux() in
  lib/imagePrep.ts; /api/render now ALWAYS resizes to 1024 (snapped
  to /32) and ALWAYS re-uploads to fal storage so the endpoint pulls
  from fal's own CDN instead of a Supabase signed URL across regions.
  Replaces the previous computeFluxDimensions+conditional-trim-only
  upload flow. (2) Vision base64 inline: analyseRoom() flipped from
  `source: { type: 'url' }` to `{ type: 'base64' }`. The Anthropic
  API used to fetch the Supabase signed URL server-side from US
  infrastructure to Sydney storage (~1-2s of pure latency on top of
  inference); now the buffer goes inline. All four callers updated —
  /api/analyse-room passes the in-memory photoBytes directly,
  /api/advise + /api/projects/[id]/analyse download from Supabase
  Storage (closer geographically than Anthropic), eval passes its
  normalised buffer. New VisionMediaType export. Eval pipeline
  mirrors prod: separate 1024-edge fal-storage upload alongside the
  1600-edge Supabase upload, plus new per-iteration timing breakdown
  (submitMs / inferenceMs / fetchMs / falInputBytes) so future
  perf changes are measurable. Wall-clock timings section added to
  summary.md.
- `2026-05-22` — **Vision boards Pass B — image upload → Claude
  vision → catalogue match (#139b).** Users can upload an
  inspiration image (Pinterest pin, IG screenshot, magazine photo)
  to a board; Claude Sonnet 4.6 vision identifies the product into a
  fixed vocabulary (category + style descriptors + materials + colour
  family + confidence) and we score the AU catalogue by overlap to
  return the top 6 matches with a "+ Add to board" button per match.
  Schema: vision_board_items.item_type extended to 'image';
  vision-board-uploads private Storage bucket with per-user-folder
  RLS. Library: lib/vision-board-image-match.ts (identifyImage,
  matchCatalogue, normaliseCategory mapping free-text categories to
  our fixed vocab). API: POST /api/vision-boards/[id]/upload accepts
  multipart photo ≤4 MB, uploads, calls vision, inserts a polymorphic
  'image' item, rolls the upload back on any downstream failure (no
  orphan blobs). UI: BoardImageUpload sits between the analysis card
  and item grid; ImageCard renders uploaded images via signed URL
  (1-hour TTL, threaded through the page since the bucket's private).
  Closes the fourth capability of the vision-board scope. Backfilled
  retroactively (commit 1356e1d didn't update the changelog inline).
- `2026-05-22` — **Vision boards Pass A — Claude designer's-read
  (#139a).** One Claude Sonnet 4.6 call delivering four capabilities
  per board, rendered as an editorial card above the item grid:
  through-line + tensions + strength badge, room-style pills,
  cross-user popularity (headline + differentiator), and retailer
  recommendations (~$0.05-0.10 / ~15s). Library: runBoardAnalysis()
  hydrates the board, computes cross-user popularity via admin client,
  calls Claude, persists. KNOWN_RETAILERS list (12 AU retailers we
  actually scrape, with strength categories) bounds Claude's retailer
  picks to real retailers, not hallucinated ones. Schema:
  vision_board_analyses table (response + snapshot + history). API:
  POST /api/vision-boards/[id]/analyse fresh-runs, GET returns latest
  cached or null. UI states: loading / no-analysis / running / result
  / stale (board drifted ≥2 items since the read). Wired into
  /vision-boards/[id] above VisionBoardDetail. Backfilled
  retroactively (commit 22e4ac3 didn't update the changelog inline).
- `2026-05-22` — **New `/palettes` page + desktop nav "Discover" →
  "Palettes" rename.** The desktop TopNav's "Discover" link pointed
  at `/dashboard` — a dead anchor for users already on /dashboard.
  Renamed to "Palettes" and retargeted to a new `/palettes` page
  that renders all 16 colour palettes in a responsive grid (sorted
  timelessness-desc so Hamptons / Federation / etc. lead). Auth-
  gated like /catalogue. Extracted the existing
  `PaletteSwatchCard` from `trends-section.tsx` to
  `components/palettes/palette-swatch-card.tsx` so dashboard
  carousel and the new page share one card visually. Also
  retargeted the dashboard "Colour palettes → See all →" link
  from `/dashboard#palettes` (self-anchor, did nothing) to
  `/palettes`. Added `app/palettes/loading.tsx` for snappiness.
  NOTE: per-page internal navs (`/catalogue`, `/projects`,
  `/rooms/new`, `/privacy`) don't yet include a "Palettes" link —
  consistency pass not in scope here.
- `2026-05-22` — **Fix: "Add to vision board" was silently broken
  on every product / palette / trend card.** The
  `<AddToVisionBoardButton>` prop was named `ref`, which is a
  reserved prop name on function components in React 18 — React
  intercepted it and filtered it out before the component received
  props, so the destructured `ref_` was always `undefined` and the
  POST body to `/api/vision-boards/[id]/items` shipped as the
  string `"undefined"`. Renamed the prop to `itemRef` across the
  component definition + all 6 call sites (`catalogue/page.tsx`,
  `featured-products-section.tsx`, `trends-section.tsx` ×2,
  `trending-products-section.tsx`, `showpiece-render-section.tsx`).
  Added an in-file note on the prop interface warning future-me
  off the reserved name. Net effect: every "+ Add to board" CTA
  now actually saves.
- `2026-05-22` — **Perceived-snappiness pass on mobile navigation.**
  Two compounding fixes for the "I tapped Shop and nothing happened
  so I tapped it three more times" UX. (1) Added `loading.tsx`
  skeletons at the four high-traffic dynamic routes
  (`/dashboard`, `/catalogue`, `/projects`, `/vision-boards`) —
  Next streams the skeleton instantly on click so the page-load
  RTT to Vercel + Supabase queries no longer reads as
  unresponsiveness. Skeletons mirror each page's header band +
  hero rhythm + content grid so the layout doesn't jolt when real
  content streams in. (2) Refactored `BottomNav` to track an
  optimistic `pendingMatch` state on tap via `useTransition` +
  `router.push` — the tapped tab lights up the millisecond your
  thumb releases, before any RSC payload arrives. Pending state
  clears via `useEffect([pathname])` once the URL catches up.
  Modifier-clicks fall through to browser default; tapping the
  current tab is a no-op (no spurious re-activation).
- `2026-05-22` — Removed dead `/retailers` link from the desktop
  TopNav (route never existed; would 404 on click). Catalogue
  page already surfaces retailer filtering via its chip row, so a
  separate Retailers destination would be redundant rather than
  worth stubbing. Also fixed a stale `< 7 / >= 7` comment in
  `upload-form.tsx` that the previous threshold-raise commit
  missed.
- `2026-05-22` — Trend-vs-Tried-&-Tested threshold raised from
  `timelessness >= 7` to `>= 9` across all 5 consumers
  (`wizard-carousel-chooser.tsx`, `trends-section.tsx`,
  `upload-form.tsx`, `project-wizard.tsx`, `brief-picker.tsx`).
  Restores the 10 trend-forward / 6 timeless split the JSON's own
  description claims; the previous threshold had drifted to 6 / 10
  as palette `timelessness` scores were re-tuned upward over time.
  Tried & Tested bucket now: Hamptons Heritage, Honest Essentials,
  Australian Federation, Mid-Century Walnut, Coastal Whitewash,
  Modernist Restraint. English Country (8) moves into 2026 trend
  alongside Warm Grounded Earth, Misty Blue Neutral, Silhouette &
  Pale. Data unchanged; threshold-only fix. The constant is still
  duplicated locally in two files (not centralised) — left as-is
  to keep the change scope-tight.
- `2026-05-22` — **`public.users.first_name` column added.** Migration
  `20260522130000_users_first_name.sql` adds a nullable `first_name
  text` column and updates the `handle_new_user` auth trigger to
  populate it from `raw_user_meta_data->>'first_name'` on signup
  (future-proofs the signup form when it starts capturing names).
  Dashboard's `firstName` derivation now prefers
  `public.users.first_name` and falls back to the existing
  email-prefix heuristic when null — single source of truth feeds
  both `TopNav` and `HeroGreeting`. Backfill of existing closed-beta
  accounts runs separately via Supabase Studio SQL editor to keep
  beta-tester emails out of source control.
- `2026-05-22` — iOS PWA status bar flipped to `black-translucent`
  (was `default`). Content now extends edge-to-edge under the status
  bar. Status bar icons render white over our cream background —
  trialling raw without a dark scrim to see how unreadable it
  actually feels on device before deciding next step. Single
  metadata change in `apps/web/app/layout.tsx`; trivially revertible.
- `2026-05-22` — **PWA enablement for iOS Add-to-Home-Screen testing.**
  Added `apps/web/app/manifest.ts` (standalone display, cream theme,
  start_url `/dashboard`), `apps/web/app/apple-icon.tsx` (180x180 PNG
  monogram via `next/og` ImageResponse), `apps/web/public/icon.svg`
  (brand mM lockup — italic taupe `m` + roman ink `M`),
  `apps/web/public/sw.js` (intentionally cache-less so beta deploys
  are never masked), and `apps/web/components/pwa-register.tsx`
  (client-side SW registrar). Layout's metadata export now declares
  `manifest`, `appleWebApp`, `icons`, and `viewport.viewportFit:
  cover`. Goal: open the deployed Vercel URL on iPhone, tap Share →
  Add to Home Screen, and review the mobile-first IA from #134 in a
  standalone shell that matches what TestFlight would look like — no
  Capacitor rewrite yet. Future option: same code wraps into
  Capacitor for App Store distribution when beta opens.
- `2026-05-20` — **Render pivot to fal-ai/flux-pro/kontext/multi**
  shipped to production (tasks #94 + #95 closed). After 15 prompt-
  engineering rounds against fal-ai/flux-general with canny + IP-
  Adapter that hovered between 3.3 and 4.7 average, round 14 broke
  the 5.0 ceiling for the first time using the multi-image Kontext
  endpoint with per-fixture vision facts injected as preserve
  directives. Diagnosis of the previous ceiling: canny + IP-Adapter
  on fal couldn't separately treat surface colour from geometry
  preservation — IP-Adapter palette only landed on soft furnishings,
  walls stayed locked by canny edges. Kontext takes [roomPhoto,
  paletteSwatch] as image_urls and reasons compositionally — palette
  finally landed on walls. Production wire-up via env-gated
  getActiveProvider() in lib/fal.ts (default kontext-multi); both
  /api/render and /api/renders/[id]/status dispatch the right
  submit/poll pair based on FLUX_PROVIDER. New lib/kontextPrompt.ts
  shared between /api/render and eval; pipes Claude vision analysis
  facts (flooring, light.notes, ceiling description, architectural
  features, existing_furniture[condition=keep|replace]) into the
  prompt as explicit "MUST preserve" / "ACTIVELY REPLACE" lines so
  Kontext can't reinterpret architecture as a different style.
  Round 15 also strengthened NEGATIVE language for recurring
  hallucinations (crown moulding, pendant lights, casement windows).
  Also: confirmed both XLabs v1 AND InstantX Flux IP-Adapters fail
  on fal-ai/flux-general with the same tensor dimension mismatch
  (32 vs 1056) — fal's flux-general IP-Adapter loader is broken for
  any Flux adapter. Legacy flux-general path stays accessible via
  FLUX_PROVIDER=flux-general for rollback if needed.
- `2026-05-20` — Signorino tile scraper shipped. Premium AU tile +
  natural stone importer (signorino.com.au, custom CMS). Walks /range
  index → 98 ranges total, walks first 40 → 230 tile variants. Each
  range page exposes ~6 colour variants as <img> elements with alt
  text like "Bari Amazonite", "Allure - Alaska", "Anthology Dark".
  alt → variant name; img.src → high-res hero. Tiles category is
  particularly valuable because each tile has a very specific
  dominant colour (calacatta marble = #F3F0E8, terracotta = #C4785A,
  black slate = #2A2825) — palette-match filter places them very
  precisely. Also added Tiles to bathroom + kitchen room hints in
  lib/featuring.ts so auto-feature picks them up. 230 tiles / 0
  errors. Can extend TARGET_RANGES later if more variety needed
  (58 ranges remain unwalked).
- `2026-05-20` — Letterbox trim. The eval fixture (master_bed.PNG,
  2532×1170) was an iPhone screenshot of a real-estate-website photo
  with 38% of the width consumed by black bars. Three downstream
  failures resulted: canny ControlNet preserved the black-to-photo
  boundary, computeFluxDimensions mis-derived a 2.16:1 aspect, and
  the Claude vision evaluator scored the whole bordered output. New
  lib/imagePrep.ts trimBlackBorders() handles it via sharp.trim().
  Used in both the eval pipeline and /api/render (re-uploads trimmed
  buffer to fal storage so the user's original photo isn't mutated).
- `2026-05-20` — The Rug Est scraper shipped (second half of #81,
  completes the task). Premium AU handmade rug brand at therugest.com
  (custom CMS, no sitemap/products.json). Walks /current-range +
  /limited-edition, harvests depth-2 `/p/<range>/<variant>` URLs,
  visits each detail page for og:image (2000x2000 hero) + h1 + low
  price tier (rugs are size-priced — we store the cheapest size).
  First run: 107 rugs / 0 errors / 100% palette pass-rate. Combined
  with Choices Flooring's 15 rugs, the rug category went from 0 to
  122 SKUs — substantial coverage for living-room renders.
- `2026-05-20` — Fal submit fallback. Round 7 evals consistently
  died at the fal submit step with no diagnostic — the InstantX
  ip_adapters[] shape was being rejected and the error bubbled up
  uncaught, leaving runs with no rendered.jpg + empty results.json.
  submitDepthRender now logs fal's full error body and on IP-Adapter
  rejection retries with a text-only payload so we always produce a
  baseline render. Trades "every render fails" for "IP-Adapter may
  not engage but render lands at round-5 quality." Next eval will
  surface the exact fal rejection reason so we can fix the config
  (or pivot to a known-working IP-Adapter on a different host).
- `2026-05-20` — Choices Flooring scraper shipped (first half of
  task #81). Major AU flooring + window-furnishings retailer running
  a custom Shopify storefront. Walked 4 category PLPs: /timber-
  flooring/ (12), /laminate-flooring/ (6), /carpet/ (12), /rugs/ (15)
  — note Choices sells rugs too, which gives us partial coverage of
  the rug brief while the original "Rug Establishment" URL is
  unresolved (domain doesn't resolve; awaiting confirmation of brand
  name from the brief). 45 products / 0 errors / 100% palette
  pass-rate. Adds laminate as a new flooring sub-type the catalog
  didn't have. Price stays null — Choices uses qualitative `$$$`
  tier indicators on the PLP, not flat SKU prices (per-m² for hard
  flooring, made-to-measure for everything else).
- `2026-05-20` — **IP-Adapter pivot — visual palette conditioning**.
  After 5 prompt-engineering eval rounds (scorecards: 4.7 → 3.3 → 4.5
  → 4.0 → 4.0 average) palette adherence specifically refused to clear
  4/10. Diagnosis: Flux's training has only loose associations between
  paint names and hex values; "warm wheat tones" can land anywhere in
  the warm-beige tonal space. Text vocab has a structural ceiling.
  Pivoted from `fal-ai/flux-control-lora-canny/image-to-image` to
  `fal-ai/flux-general/image-to-image`, which exposes the underlying
  Flux pipeline so we can stack three conditioning signals in one
  call: init image (room photo), canny structure preservation via
  `easycontrols[]`, and palette swatch visual conditioning via
  `ip_adapters[]`. New `lib/paletteSwatch.ts` generates a 512x512 PNG
  with the palette's 5 role colours (Wheat / Caramel / Walnut /
  Cognac / Espresso for Warm Grounded Earth) as horizontal stripes;
  it gets uploaded to fal storage per-render and passed as the
  IP-Adapter reference. New `lib/fal.ts:uploadImageBuffer()` handles
  the Buffer → File → fal.storage.upload roundtrip. IP-Adapter weights:
  `XLabs-AI/flux-ip-adapter` with `openai/clip-vit-large-patch14`
  encoder, scale 0.4 (balanced — higher flattens to swatch geometry,
  lower doesn't move the needle). Legacy endpoint kept for the
  /api/warm warmup ping only. Eval runner updated in tandem — and
  fixed a long-standing bug where eval was calling
  `buildPrompt(style, analysis, null)` with no palette argument
  (production has been passing palette since round 3; eval lagged).
  Round 6 eval is the moment of truth.
- `2026-05-20` — Auto-feature palette-matched catalogue items in
  render prompt. Before this, Fal re-imagined every soft furnishing
  generically — "linen bedding" became Flux's idea of generic linen,
  not an Adairs Mason Quilt Cover. The catalogue only entered the
  picture AFTER the render via the picking-list match step. New
  `lib/featuring.ts` closes ~40% of the gap cheaply: when the user
  picks a palette but doesn't explicitly select featured products,
  `/api/render` queries the palette-tagged catalogue for room-
  appropriate items (`ROOM_CATEGORY_HINTS` maps room_type → category
  list, dedupes by category for variety, caps at 3, skips Dulux), and
  passes the picks as heroProducts so `buildPrompt` names them in the
  prompt ("featuring adairs ultra soft jersey rose & cedar stripe
  quilt cover separates, carpet court barakula carpet, poliform
  jacqueline bed"). Also patched `describeProduct` to suffix the
  category word when the product name is a brand/model string with no
  object anchor — "Barakula" + category "Carpet" → "barakula carpet"
  so Flux paints a carpet, not a mystery noun. The other ~60% of the
  catalog-to-render gap still needs IP-Adapter (visual style
  conditioning on actual product images) or post-render composite
  (Flux Pro Fill paste) — deferred until A's lift is measured.
- `2026-05-20` — Render prompt round 4 + Dulux library expansion.
  Round 3 eval (4.5/10 avg, palette adherence 3/10) revealed Flux had
  drifted the Warm Grounded Earth palette to cool sage-green. Two
  fixes landed:
  (a) **Dulux scraper rewrite**: was walking 9 `/colour/<hue>/popular`
      index pages and capping at 200 colours (we only got 187). Now
      walks the public sitemap.xml for 1,259 individual colour pages
      across 11 hues (whitelist excludes design-effects, colour-trends,
      colorbond, metalshield, etc.) with parallel batched fetches
      (8 concurrent, 250ms inter-batch). Re-ingest landed 1,144 of
      1,259 paints (115 correctly palette-filtered as off-palette).
      Per-palette Dulux coverage now 431–828 candidates each (was
      ~30 each). The Atlas (`/specifier/colour/colour-atlas/`) would
      have given ~3,000+ via JS click-to-expand on each family card
      but is more complex to scrape AND past 1,000 paints the
      wall-matcher's marginal precision is diminishing — sitemap is
      the right cost/benefit point.
  (b) **Prompt round 4**: palette directive moved to FRONT of prompt
      (was after style.descriptor — Contemporary AU's descriptor has
      "eucalyptus green accents" baked in, which contradicted any
      palette and likely caused the sage-green drift). Added
      `stripAccentColours()` helper that removes "<colour> accents/
      tones" fragments from style.descriptor when a palette is
      selected. Wall vocab enriched per palette family: warm palettes
      now read "walls painted in warm wheat, biscuit, cream, clay and
      oat tones — a soft warm beige" with extended adversarial list
      "NO green. NO sage. NO mint. NO khaki. NO olive" (round 3 only
      blocked grey/blue-grey/white). View directive re-strengthened
      to single CRITICAL (round 2's overconstraint came from STACKED
      ceiling + view criticals, not view alone). Canny strength
      bumped 0.65 → 0.75 to lock geometry against the spatial
      compression the eval flagged.
- `2026-05-20` — Carpet Court scraper shipped (task #90 — closes the
  flooring + curtain catalogue gap and supersedes the cancelled Carpet
  Call task #86). Carpet Court runs on Magento 2 with a 5s
  Crawl-delay; sitemap is mostly blog content so we walk a curated set
  of category PLPs instead (room-based for carpet, type-based for
  curtains). Each `.product-item` card on the PLP carries title +
  image + URL — no per-product page visit needed. Per-room walks
  (bedroom / living-room / hallway / kids / stairs) capture which
  rooms a carpet is suitable for; that survives into the products row
  as `dimensions.rooms = ['bedroom','hallway','stairs']` so the
  picking-list query can filter via `dimensions->'rooms' ? 'bedroom'`.
  Curtains carry no room lock (universally suitable). First run: 18
  unique carpets across all rooms + 12 sheers + 5 blockouts = 35
  products, 0 errors. Pricing stays null because carpets are sold
  per m² and curtains are made-to-measure — the UI will surface a
  "Get a quote" CTA in that case (task TBD).
- `2026-05-20` — **Memo (no code yet)**: Consumer-brief → Claude vision
  → render pipeline. Tasks #91/#92/#93 capture the work. Today the
  consumer picks a palette from a list of 10 swatches — high friction,
  high paralysis, and the palette they pick is often the wrong one for
  what they actually want. The proposed flow: replace the palette
  swatch step with a multi-select keyword brief (Mood / Lifestyle /
  Aesthetic / Function / Constraints categories) plus an optional
  free-text field, then have Claude Sonnet vision read (a) the keyword
  brief, (b) the room photo, (c) our 10 palette definitions, and pick
  the best-fit palette plus per-consumer variation hints ("Warm
  Grounded Earth, but lean to the lighter Wheat tones because user
  said 'bright and airy'"). Variation hints flow into buildPrompt as
  additional palette directives so the same palette can render
  differently for different consumers. Claude becomes the designer
  matching consumer brief to industry themes; the consumer doesn't
  need to know what "Warm Grounded Earth" means. Eval scorecard gains
  a "brief adherence" criterion. Unlocks B2B Design Studio use case
  (designer fills a client brief, system synthesises render direction)
  AND lowers the consumer onboarding bar (chips, not jargon). Sized
  at ~2 weeks once we're through the current scraper batch + eval
  iteration.
- `2026-05-20` — Adairs scraper shipped (first delivery of task #80
  split — bedding via quilt/doona/duvet covers). Adairs runs on
  Episerver/Optimizely (not Shopify — `/products.json` 404s, and the
  `products-sitemap.xml` is polluted with discontinued z-archive
  products), so the scraper walks paginated PLPs at
  `/bedroom/quilt-covers-coverlets/?page=N`. Each `.ProductCard` on
  the listing carries title (img.alt), SKU (`data-uniqueid`), product
  URL (anchor href), CDN image URL (img.src), and price range as
  text — no per-product page visit needed, ~10s per PLP. First run
  produced 120 products / 0 errors; palette-match dry-run on 30 of
  them showed 100% pass rate clustering on `honest-essentials`,
  `silhouette-and-pale`, `pistachio-chocolate`, `warm-grounded-earth`
  — Adairs' bedlinen catalogue is heavy on warm neutrals which
  matches the dominant AU palette set.
- `2026-05-20` — Render prompt rewrite (eval round 3). Round 2 had
  shipped hex codes (`#E8D5B7`) in the wall directive plus parallel
  `CRITICAL: ceiling IDENTICAL` + `CRITICAL: view IDENTICAL` lines
  plus strength 0.80. Result: palette adherence dropped from 4/10 to
  2/10, surface transformation from 4/10 to 2/10. Diagnosis: Flux
  reads hex codes as gibberish (no acting on `#E8D5B7`); the parallel
  CRITICAL preservation directives over-constrained the model into
  "don't change anything"; strength 0.80 didn't help. Round 3:
  buildPrompt now uses the palette's named colours per role (Wheat
  walls, Caramel upholstery, Walnut floor, Cognac accent, Espresso
  trim — actual paint/material vocab Flux trained on); adversarial
  "NO cool grey, NO blue-grey, NO white walls" language at the end of
  the wall directive (closest thing Flux has to a negative prompt);
  ceiling CRITICAL dropped (canny at 0.65 already pins ceiling
  fixtures via edges — the speaker hallucination from round 1 was a
  one-off); view directive softened (no all-caps); strength 0.80 →
  0.85; guidance 4.0 → 5.0 to push the named palette tokens harder.
- `2026-05-20` — Palette-match catalog filter shipped (task #89). Every
  scraped product now runs through `apps/scraper/utils/paletteMatch.js`
  at ingest time. The module extracts a dominant colour from the product
  image (sharp centre-crop → resize-to-1px), converts to CIE Lab, and
  tags the row with the IDs of every palette whose colours fall within
  ΔE 20 of that dominant. Products that match no palette are dropped at
  the ingest step — they'd never surface in a picking list anyway.
  Paint products (Dulux) skip the image fetch and use the
  retailer-published swatch hex in `dimensions.hex` directly. New
  column `products.palette_tags text[]` with a GIN index supports
  fast `palette_tags @> ARRAY[$paletteId]` filtering at picking-list
  query time. Threshold tunable via `PALETTE_MATCH_THRESHOLD` env.
  Dry-run against all 9 existing retailers showed 100% pass-rate —
  consistent with AU interior catalogues already trending neutral/earth;
  the matcher correctly admits everything except saturated off-palette
  outliers. Also cancelled the Carpet Call task (#86, 403'd bot
  detection) since Carpet Court (#90) covers the same brief.
- `2026-05-19` — Beacon Lighting scraper poisoning the catalogue.
  Sitemap entries outlive product pages, so visits returned 404 pages;
  the scraper happily stored those as products with name='404 Not
  Found | Beacon' and the og:image fallback brought in site logos and
  Black Friday promo banners as the product photo. Hundreds of these
  rows were in Lighting category, blocking Claude's vision ranker
  from finding real matches — possibly the reason for empty picking
  lists. Three layered defences:
  (a) Scraper checks the HTTP status code and rejects 4xx pages outright;
  (b) Rejects any page whose h1/title contains "404" or "Not Found";
  (c) Only accepts product images from `/media/catalog/product/`
      (Magento's product path) — drops the logo, banner and SVG paths
      that ogImage was leaking through.
  Plus an `isJunkRow` filter at the ingest layer as belt-and-braces so
  legacy bad data + future regressions can't reach the table. Plus
  diagnostic logging in lib/matching.ts so we can read Vercel logs to
  see exactly how many boxes Florence-2 returned, how many the
  validator kept, and how many got dropped for empty catalog matches.
- `2026-05-19` — Re-inlined the picking-list build into the status
  route. The fire-and-forget `void fetch()` trigger I'd shipped to
  decouple slow picking-list work from fast finalise was unreliable —
  Vercel could kill the function before the outbound HTTP request
  initiated, so `/build-picking-list` sometimes never ran. Symptom:
  renders landed fine but the picking list panel showed "no items
  detected yet" indefinitely. With the density already tuned down
  (12 items / 8 candidates) the inline pipeline fits comfortably
  inside the 60s function budget. /build-picking-list stays around as
  a manual rebuild endpoint but isn't auto-triggered anymore.
- `2026-05-19` — Lighting + decorative-wall gaps surfaced from a real
  bedroom render. Three fixes:
  (a) Detection vocab expanded to wall sconce / wall light / ceiling
      light / ceiling fan / downlight / spotlight / vanity light / desk
      lamp. Previously these were dropped silently — the bedroom render
      had green wall sconces and they never reached the picking list.
  (b) Vision step now explicitly captures decorative wall features in
      architectural_features (panelling, wainscoting, mouldings,
      picture rails, brick / stone feature walls). Flux at canny 0.55
      was flattening these into plain paint; now buildPrompt asks for
      structure preservation with palette-applied finish.
  (c) Bold-mode prompt also nudges Flux to swap existing wall lights /
      ceiling lights / sconces for palette-appropriate alternatives
      rather than leaving them as the original.
  Plus a memo (task #87) — surface walls themselves as a picking-list
  item with Dulux paint matches. Florence-2 can't detect surfaces so
  this is its own work item.
- `2026-05-19` — Staged composites looked "pasted" — hard edges, wrong
  light direction, blurry cutouts. Three fixes layered on top of the
  composite pipeline shipped earlier:
  (a) URL upgrade — Shopify default URLs come back at thumbnail
      resolution (`_600x.jpg`); we now strip the size suffix to fetch
      the master image. Contentful (Dulux), Freedom and WordPress
      patterns also handled.
  (b) Feathered edges — sharp blurs the alpha channel by a few pixels
      so the silhouette reads as anti-aliased rather than hard-cropped.
  (c) Harmonisation pass — gentle Flux img2img at strength 0.18 after
      the composite blends edges into the scene, integrates shadows,
      matches colour temperature. Falls back to the raw composite if
      the fal call errors so we never block on it.
- `2026-05-19` — Renders trapped in "running" for 5+ minutes. Root
  cause: status route did Flux finalise AND picking-list build inside
  a single 60s function, but the picking list (Florence-2 + 15 Claude
  validator calls + 15 Claude ranker calls with 12 image attachments
  each) was routinely overrunning 60s. Vercel killed the function
  before the renders row could update; the next poll retried the same
  expensive work; loop. Split into two phases: status route now only
  does the cheap "Flux done → upload to storage → set status=succeeded"
  finalise (~10s), then fire-and-forgets a POST to a new endpoint
  `/api/renders/[id]/build-picking-list` which runs the heavy work in
  its own 60s budget. Picking-list density reduced from 15 items to 12
  and from 12 candidates to 8 for safety. Idempotent — multiple
  in-flight builds short-circuit on already-populated picking_list.
- `2026-05-19` — SKU fidelity fix shipped (task #73). Staging no longer
  goes through Flux Pro Fill with a text description (which invented a
  generic version of whatever you picked). New pipeline: background-
  remove the product image via `fal-ai/birefnet/v2`, composite the
  actual pixels onto the room photo with sharp at the picking-list
  bbox, add a soft drop shadow for grounding. Multi-stage runs all the
  birefnet calls in parallel and z-orders by bbox area so larger items
  composite first. The selected SKU is now exactly what lands in the
  scene.
- `2026-05-19` — Aggression dial pushed harder. The first test showed
  Stage 1 settings still left walls + flooring + curtains untouched —
  canny LoRA at 0.85 was locking the surface textures even with
  strength bumped to 0.82. Loosened canny to 0.55 (room geometry still
  anchored, surfaces free to repaint) and bumped strength to 0.87.
  Above 0.88 strength Flux hallucinates windows, so we sit just under
  that ceiling.
- `2026-05-19` — Render quality fixes from first end-to-end test:
  (a) /api/render now reads the source photo's dimensions with sharp
  and computes Flux-valid output dims that preserve aspect — fixes the
  stretched/squashed output when a portrait phone shot was forced into
  landscape_4_3; (b) Claude vision validator no longer sees the
  Florence-2 hint ("Florence-2 thinks this is X, what is it really?"),
  which was anchoring its judgement and letting mislabels through.
  Now classifies fresh from the crop and gets called out specifically
  on the chair-vs-bedside-table edge case. The third issue from the
  test — staged SKU rendering as a generic version of itself instead
  of the actual product — is task #73 (reference-image inpainting),
  still pending.
- `2026-05-19` — Second-round scraper triage. Koala + Woodcut both
  needed Playwright after Node `fetch` couldn't get past their WAFs
  (Koala dropped TCP entirely, Woodcut returned a 403 HTML page in
  place of /sitemap.xml). Rewrote both to launch Chromium, warm up the
  context with a homepage visit so Cloudflare cookies land, then
  fetch via the browser-context API. Koala iterates products.json
  through that context; Woodcut harvests `/wood/<slug>/` hrefs from
  the rendered DOM of each collection page.
- `2026-05-19` — Scraper triage from first parallel batch run. Koala TLD
  fix (`koala.com` → `koala.com.au`). Dulux rewritten to parse
  `__NEXT_DATA__` JSON instead of regex (the previous version was
  matching the page background CSS so every colour came out as
  `#F7F8F4` — now pulls structured hex / Atlas code / Chip code / LRV
  per swatch). Woodcut rewritten to read sitemap + `/wood/<slug>/`
  URL pattern (was looking for `/wood-finishes/<slug>/` which doesn't
  exist). Freedom enhanced with longer hydration wait + API-response
  interception fallback for the Angular SPA. Carpet Call removed from
  default orchestrator (403 bot detection — needs partner API,
  memoed as task #86).
- `2026-05-19` — Render revision history shipped (task #85). New
  `render_revisions` table + `renders.active_revision_id` pointer.
  Every original render + every staging is now a versioned revision;
  the render page reads the active one as the "after" image. A
  RevisionStrip below the before/after slider lets the user click any
  past revision to revert or roll forward — no fal calls, pure
  pointer flip via `PATCH /api/renders/[id]/revisions`. Fixes the bug
  where staging composites appeared briefly in the modal then "vanished"
  because the page kept showing `renders.output_url`.
- `2026-05-19` — Stage 3a (parallel) catalog batch shipped (task #84):
  six new retailer scrapers — Koala (Shopify), Beacon Lighting (Magento
  +Playwright, desk+floor lamps only), Freedom (Angular SPA+Playwright,
  mirrors+rugs+sofas), Dulux (Cheerio-free HTML scrape of the colour
  library), Woodcut (WordPress HTML scrape, engineered timber), Carpet
  Call (Magento+Playwright with bot bypass, wool+synthetic). Orchestrator
  rewritten to Promise.allSettled — one retailer crashing no longer
  takes down the batch. New npm scripts scrape:koala, scrape:beacon,
  scrape:freedom, scrape:dulux, scrape:woodcut, scrape:carpetcall.
  Tasks #79 (Beacon Lighting) and #64 (Freedom) closed.
- `2026-05-19` — Claude opinion: vision step now defaults `existing_furniture.condition`
  to "replace" rather than "keep". Designer system prompt reframed —
  "same room *reimagined*" — and instructed to interrogate every "keep"
  flag the vision step emits. Stops the pipeline from biasing toward
  conservative recommendations before the user even sees a render.
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
| **CLIP pre-rank (#146)**      | CLIP ViT-B/32 (HF Inference REMOTE on Vercel, LOCAL onnxruntime in dev) + pgvector HNSW | Embeds the cropped render region once per box and calls `match_products_filtered` RPC — palette_tags + room_tags filter, cosine sort, returns the top-K visually-similar candidates. Falls back to the legacy palette+price-desc query when embedding or RPC fails so the matcher never starves on a flaky upstream. |
| **Vision validation + rank**  | Anthropic Claude Haiku 4.5             | Crops each detection and asks Claude to classify (drops anything it reads as architecture, walls, doorways). Then ranks the CLIP-pre-narrowed catalogue candidates by vision. Originally replaced an earlier CLIP-only ranker; #146 brought CLIP back as a pre-rank filter, not the final ranker. |
| **Designer LLM**              | Anthropic Claude Sonnet 4.6            | Reads the room analysis, the chosen palette, the matched products, and 5–8 RAG chunks from the design-knowledge corpus. Returns the editorial "designer read" shown on the render page. |
| **Room vision analysis**      | Anthropic Claude Haiku 4.5             | One-shot structured JSON from the uploaded room photo: dimensions estimate, light direction, existing materials, architecture features. Cached on `rooms.analysis` so we never re-pay for the same upload. |
| **Catalogue scrapers**        | `apps/scraper`                         | Standalone pnpm app. Coco Republic (BigCommerce sitemap), Poliform (Shopify JSON), GlobeWest (Magento + Playwright). Each scrape writes JSON to `output/<retailer>/`, then `pnpm ingest` (single shared script) runs every product through `utils/paletteMatch.js` (Lab ΔE filter against the 10 app palettes), drops products that match no palette, and upserts to `products` via service role with `palette_tags text[]` populated. ~236 SKUs today. |
| **Trend generator**           | `apps/scraper/scripts/generate-trends.js` | Cron-run script that produces a Flux trend card per (palette × room type) and writes to `trend_cards`. Shown on the dashboard. |
| **Design knowledge RAG**      | `apps/scraper/data/design-knowledge-seed.json` → `design_knowledge` + CLIP-text embeddings | Curated 25-chunk AU corpus (Dulux 2026, S-W, Pantone, AIDA, Vogue Living AU, House & Garden, climate/building-stock notes). Retrieved via `match_design_knowledge` RPC. |
| **Hosting**                   | Vercel (region `syd1`)                 | Auto-deploy from `main`. Function timeout 60s — render and stage are async (queue submit + poll) to live within it. |

### 4.3 Key tables

| Table              | Owns                                                                 |
|--------------------|----------------------------------------------------------------------|
| `users`            | Mirrors `auth.users` via trigger. Profile fields (`first_name`) + canonical taste signal (`preferences jsonb` — `{ tags: string[], updated_at }`, see §6.11). |
| `projects`         | Top-level grouping. Status: `in_progress` → `in_review` → `completed`. |
| `rooms`            | Uploaded room photos + `analysis` JSONB (Claude's room read).        |
| `style_profiles`   | Descriptor + palette + materials + mood (per render, per board).     |
| `renders`          | One row per render attempt. Holds `fal_request_id`, `picking_list`, `cost_estimate_aud`, `status`, `output_url`. |
| `staged_images`    | One row per virtual-staging call. Single or multi-product.           |
| `render_revisions` | Version history per render. Original + every staging is one row. `renders.active_revision_id` points at the displayed revision. |
| `products`         | Shared catalogue. Read for all authed users; service role writes. Tag columns: `palette_tags`, `style_tags`, `room_tags`, `mood_tags`; vision-grounded fit signal: `vision_profile jsonb` (silhouette / materials / color_family / visual_tone / quality_tier / palette_fit / room_fit — populated by `apps/scraper/scripts/visionProfile.js`). |
| `shortlist_items`  | Per-project picks promoted from a render or a staged image.          |
| `trend_cards`      | Pre-rendered (palette × room) trend imagery for the dashboard.       |
| `palette_likes`    | Per-user palette hearts. `palette_id` is a text slug (no FK — palettes are compile-time JSON). Unique on `(user_id, palette_id)`. RLS: authenticated read (aggregate counts), insert/delete own rows. |
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
| Designer-curated picking step | `apps/web/lib/curation.ts` + `/api/render/curate-candidates/route.ts` |
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
- **TrendsSection** — three carousels: (1) Colour palettes — server-
  composed from top-18 most-liked palettes (aggregate across all users
  from `palette_likes`) ∪ the current user's liked palettes, ordered
  lightest→darkest by wall-colour perceptual luminance. Cold-start
  fallback: editorial `popular` tag when the likes table is empty. Each
  card has a PaletteLikeButton (heart fills optimistically, reconciles
  with server). "See all →" deep-links to `/palettes`. (2) 2026 design
  trends — trend cards keyed by (palette × room), timelessness < 9.
  (3) Tried & tested directions — timelessness ≥ 9. Only renders if
  `trend_cards` rows exist.
- **`/palettes`** (separate page) — full browse with filter chips:
  dynamic "Your likes" (hidden when 0) + DB-driven "Popular" + static
  tag chips (neutral / modern / natural / light / warm / cool / bold /
  heritage). All views sorted lightest→darkest by paletteBrightness().
  Each card has shop / start-project / like / save-to-board CTAs.
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
- **#162 — Heritage / period / colonial AU retailer scrapers.** Surfaced
  by the 2026-05-22 vision_profile rebuild + audit: after rescoring
  all 1,391 imageable products against the full 56-palette set, the
  Layer 2/3 heritage palettes added on 2026-05-20 came back with weak
  catalogue coverage. Current low-coverage palettes (all heritage /
  period leaning):
  - victorian-refined (3 total products, 0 sofas)
  - bauhaus-primary (5 total, 0 sofas)
  - french-provincial (6 total, 0 sofas)
  - cottage-english (6 total, 0 sofas)
  - forest-green-classic (7 total, 0 sofas)
  - smoky-lavender (9 total, 0 sofas)
  - aegean-blue-white (12 total, 0 sofas)
  - hamptons-heritage (0 sofas — modern variant exists but classic
    Hamptons not represented)
  - australian-federation (0 sofas)
  - english-country (0 sofas)
  - art-deco-jewel (28 total, 0 sofas)
  - sage-and-terracotta (29 total, 0 sofas)
  Root cause: the current scraper roster is biased modern /
  contemporary (Globewest, Koala, Freedom, MCM House, Coco Republic,
  GlobeWest, Beacon Lighting, etc.) — they sell beautiful modern
  pieces but their catalogues don't include period-correct upholstery,
  classical mouldings, federation-era timber pieces, or colonial-
  detail joinery. A user picking `victorian-refined` and uploading a
  living room cannot get a render that anchors on real AU products
  because we don't stock the catalogue rows.
  Target retailers to scrape (3-4 chosen for first pass):
  - **Provincial Home Living** — french provincial, english country,
    cottage. Direct match for ~4 of the under-covered palettes.
  - **Domayne** — partial heritage (Hamptons-leaning, traditional
    upholstery, classic timber). Already a brand AU users recognise.
  - **Fenton & Fenton** — eclectic / boho / heritage-with-colour. Hits
    art-deco-jewel + soft-lilac + sunset-ochre tonally.
  - **The Heritage Furniture Co. / Curio & Curio / Antique Outlet
    AU** — antique / restoration / period. One specialist source for
    federation + colonial pieces. Pick whichever has the most
    consistent product image quality + URL stability for scraping.
  After scrape: re-run `pnpm --filter @myhome/scraper run vision-profile`
  (incremental — only new rows) + `redrive-tags`. Re-run the coverage
  audit to confirm sofa-per-palette counts move into the workable
  range (≥ 5 sofas) for the targeted heritage palettes.
  Alternative path if scraping these retailers fails on TOS / image
  quality / SKU instability: revisit "cull under-covered palettes
  from the picker" (the option not taken on 2026-05-22). Memo
  rationale stays in this section either way.

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
- **#73 — SKU fidelity. SHIPPED.** Replaced Flux Pro Fill (no
  reference image possible) with a composite pipeline:
  background-remove → resize → composite → drop shadow. The actual
  SKU pixels land in the scene. Trade-off: synthesised shadow vs
  Flux-inferred shadow. Worth it for SKU fidelity.

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
- **#84 — Stage 3a: 6-retailer parallel scrape batch. SHIPPED.**
  Koala (sofas+beds), Beacon Lighting (desk+floor lamps), Freedom
  (mirrors+rugs+sofas), Dulux (paint colour library), Woodcut (engineered
  timber flooring), Carpet Call (wool+synthetic carpets). All run in
  parallel via `pnpm scrape`. Paint, Flooring, Carpet are new categories
  — they land in the catalogue but don't appear in render picking
  lists yet (Florence-2 doesn't detect surface-level products as
  discrete objects). The surface-paint / floor-overlay UI is part of
  Stage 4 emotional UX (task #82).
- **#79 — Stage 3a: Beacon Lighting scraper. SHIPPED** (covered by #84).
  Highest-impact lighting catalogue add. Desk + floor lamps only for
  the first cohort.
- **#80 — Stage 3b: Spotlight + Adairs curtains/textiles.** Curtains
  is a brand-new category as of Stage 1 — empty catalog today.
- **#81 — Stage 3c: The Rug Establishment + Choices Flooring.** Rugs
  + hard flooring. Sandstone-2026 palette especially calls for oak +
  herringbone + travertine.
- **#163 — Stage 4b: never-empty Complete-the-Look carousels.
  SHIPPED 2026-05-22.** `fetchCompleteTheLook` in
  `lib/completeTheLook.ts` had 3 tiers (palette+room+style →
  palette+room → category+room) and dropped empty categories at the
  end — so heritage palettes with thin catalogue coverage (#162) or
  obscure categories (curtains pre-Spotlight scrape) showed nothing
  for those rows. Added tier 4: user-signal fallback. Combines (a)
  the user's wishlist intersected with the category — strongest
  personal signal — and (b) catalogue rows scored by the
  prefs-vision-fit ranker (#156) against the user's current
  `users.preferences.tags`. Tiers 1-3 hold a stricter ≥ perCategory
  threshold so any thin palette result drops to the supplement
  rather than half-filling the row. Empty-category drop at the end
  removed — every category in `ROOM_CATEGORY_MANIFEST[room_type]`
  now appears in the response, with a `source: 'palette' | 'mixed' |
  'user_signal' | 'empty'` provenance so the UI can label fallback
  origin if desired. Wishlist loaded once per render via a single
  foreign-table embed query; prefs ranker re-uses the deterministic
  scorer from #156. Carousels now always have a story to tell, even
  when the palette is thin.
- **#82 — Stage 4: "Visualise this whole room" + emotional UX.
  SHIPPED 2026-05-22.** New module `lib/auto-stage.ts` hooks into
  the `after()` block in `/api/renders/[id]/status` right after the
  picking list flips to 'ready'. For every detected non-paint item
  with a top match that has a `productId` + `imageUrl`, build a
  `MultiStageItem` and call the existing
  `stageMultipleProducts()` pipeline (background-remove via
  birefnet → composite → harmonise via Flux Kontext). Cap at
  4 items (matches the manual `/api/stage-multi` MAX_ITEMS so
  composite cost stays bounded). Persist as a new `multi_staged`
  revision and flip `renders.active_revision_id` so the user sees
  the staged composite by default. Label `+ N products (auto)`
  distinguishes auto-stages from user-initiated multi-stages in
  the revision strip so reverting is one click. Failures are
  logged + swallowed — base render + picking list still succeed.
  Kill-switch: `AUTO_STAGE_ALL=false` env var. Closes the
  catalog-to-render fidelity gap (#73 SHIPPED the manual path; #82
  makes real SKU pixels the default surface).
- (Stage 5 = warm-lead retailer plumbing — covered by existing
  pending tasks #52 + #53.)

### 6.9 Catalogue intelligence (matcher acceleration)

Pre-compute per-product visual + style fit so the render-time matcher
does less work, faster. The current rule-based `palette_tags` derivation
(see migration `20260520130000_products_style_room_mood_tags.sql`)
inherits tags from the palette definitions — two sideboards from
different retailers tagged for warm-grounded-earth can look completely
different yet score identically because Claude has never looked at the
product image. Ground the tags in vision, then add a CLIP pre-rank so
the per-render Claude Haiku ranker can shrink (or disappear).

Render-time matcher tail today: ~10–15s (8 boxes × Claude Haiku rank,
throttled at `RANK_CONCURRENCY=4` to stay under Haiku's 50K input-
tokens/min ceiling — see `apps/web/lib/matching.ts:84-94`). Target
end-state: ~3–5s with visibly more on-brief picks.

- **#145 — Vision-grounded `vision_profile` on every product.**
  *Foundation shipped — backfill pending.* Migration
  `20260522160000_products_vision_profile.sql` adds the `jsonb` column
  + GIN index. Scraper script `apps/scraper/scripts/visionProfile.js`
  iterates the catalogue, calls Claude Haiku on the product image with
  a compact descriptor of all 56 palettes in the cached system prompt,
  and returns structured output: silhouette, materials, color_family,
  visual_tone, quality_tier, per-palette fit (≥0.4) and per-room fit
  (≥0.4). Resumable (skips already-populated rows unless `--rebuild`),
  concurrency-bounded at 4 workers, prompt-cache amortises the system
  block across the run. Invoke:
  `pnpm --filter @myhome/scraper run vision-profile`. Catalogue-wide
  backfill is ~$15-30 one-off at Haiku pricing; not yet run.
  The column is consumed by the matcher refactor (#147); until that
  ships the data sits inert and `palette_tags` still drives candidate
  selection. Knock-on win once consumed: better featured-curation
  inputs and better material for the brief-to-retailer flow (#53).

- **#146 — Backfill CLIP embeddings + pgvector pre-rank in matcher.**
  *Shipped.* Migration `20260522170000_match_products_filtered_rpc.sql`
  adds `match_products_filtered(query_embedding, category_list,
  palette_id, room_type, match_count)` which filters by palette_tags +
  room_tags and sorts by HNSW cosine distance. `fetchCandidates()` in
  `lib/matching.ts` now embeds the crop once via `@/lib/embeddings`
  (HF Inference on Vercel, LOCAL onnxruntime in dev) and calls the
  RPC; falls back to the legacy palette+price-desc filter when the
  embedding or RPC fails. The catalogue embedding column
  (`products.embedding vector(512)`) and the `embed.js` script already
  existed from M2; this work just consumes them again. Backfill is via
  `pnpm --filter @myhome/scraper run embed` — coverage gaps fall
  through to the legacy path so the matcher never starves. Latency
  win compounds with #147 when the Claude ranker shrinks.

- **#147 — Matcher refactor: consume `vision_profile`, drop ranker
  candidate count.** *Foundation shipped — eval-gated tuning pending.*
  Migration `20260522180000_match_products_by_vision_profile_rpc.sql`
  adds `match_products_by_vision_profile` which filters by
  `vision_profile.palette_fit[$palette] >= 0.6` and
  `vision_profile.room_fit[$room] >= 0.6`, then HNSW cosine-sorts.
  `fetchCandidates()` in `lib/matching.ts` now tries this RPC first,
  falls through to the #146 `match_products_filtered` (palette_tags
  + room_tags) when vision_profile coverage is thin, then to the
  legacy non-RPC path. The deploy is inert on the new tier until the
  #145 visionProfile.js backfill runs in production — Tier 1 returns
  0 rows and Tier 2 (#146 behaviour) takes over. Once the backfill
  populates the column, Tier 1 begins surfacing visually + semantically
  appropriate candidates and the matcher's pre-filter is grounded in
  Claude's per-image judgement, not in inherited palette_tags.
  *Deferred:* (a) drop CANDIDATES_PER_ITEM from 5 → 3 — gated on an
  A/B eval per the spec; the current UX shows 5 cards per box.
  (b) Formal A/B eval vs the pre-#146 matcher — a separate ticket
  once vision_profile coverage is non-trivial in production.
  (c) Re-evaluate the deferred vision Haiku → Sonnet upgrade memo —
  Sonnet's reasoning headroom pays off more on `vision_profile`
  generation than on per-render room reads.

- **#148 — `vision_profile` as source of truth, old tag columns
  become projections.** *Shipped (with soft divergence on ingest).*
  After the #145 backfill hit 99.1% coverage on imageable rows, the
  four tag columns now flip to vision-derived for any row that has a
  `vision_profile`. Column names unchanged — featured-curation and
  other consumers keep reading without code change.

  Mapping (mechanical, in `apps/scraper/utils/visionTags.js`):
  ```
  palette_tags  ← keys of vision_profile.palette_fit where score >= 0.4
  room_tags     ← keys of vision_profile.room_fit where score >= 0.4  ← vision-grounded
  style_tags    ← union of style_tags from palettes.json for each palette
                  in palette_tags (productTags.deriveTags with
                  vision-grounded membership)
  mood_tags     ← same union pattern, mood side
  ```

  Shipped:
  1. `apps/scraper/utils/visionTags.js` — shared
     `tagsFromVisionProfile(profile, category)` derivation.
  2. `apps/scraper/scripts/redeRiveTagsFromVisionProfile.js` — one-shot
     pass over rows with `vision_profile`. Idempotent (skips rows
     where the derived shape already matches). Invoke via
     `pnpm --filter @myhome/scraper run redrive-tags`.
  3. `apps/scraper/scripts/visionProfile.js` — fold tag derivation
     into the same UPDATE that writes `vision_profile`, so the
     catalogue stays in lock-step going forward.

  Deliberately NOT shipped (soft divergence from the original spec):
  4. `apps/scraper/scripts/ingest.js` is **unchanged**. The original
     memo proposed stopping tag-writing at ingest entirely, but that
     would leave the 1,159 paint products (no `image_url`, no
     `vision_profile`) with empty tag arrays. Better: ingest keeps
     writing ΔE76-derived tags for imageless rows; vision overwrites
     them for vision-profiled rows. Vision wins where it can, ΔE76
     stays as the floor.

  Optional follow-up (deferred): drop `room_tags` and `mood_tags`
  columns entirely once all consumers read from `vision_profile`
  directly. Keep `palette_tags` (small, cheap, useful for quick
  dashboards / ad-hoc filtering). `style_tags` stays until
  featured-curation is rewritten against `vision_profile.color_family`
  + `palette_fit` directly.

  Sequencing rule: do NOT flip until vision_profile coverage is >~95%
  in production. The Tier-1 matcher RPC already prefers vision_profile,
  so during the partial-coverage window we want palette_tags to remain
  as the safety net for Tier-2 fallback. Flipping early means rows
  without vision_profile get empty tag arrays overnight and
  featured-curation + matcher Tier-2 silently lose them.

**Cross-references:**
- The deferred room-side **vision→matcher bundle** memo (purchase_
  opportunities + replacement_hint on the user's room) is the
  complement to this work. Together they make both ends of the
  matcher smarter. Consider scheduling #145 alongside the room-side
  bundle so the prompt-engineering effort is amortised.
- Reference-image inpainting (#73, shipped) handles SKU fidelity in
  the *render* (composite pipeline puts the actual product pixels in
  the scene). This bundle handles SKU fidelity in the *match* — the
  shopping list points at the right SKU in the first place.
- The Stage 5 warm-lead retailer plumbing (#52, #53) gets richer
  signal once `vision_profile` lands: a brief can be routed by
  visual fit, not just by category.

### 6.10 Sensor fusion (room scan + vision)

The geometry-hallucination class of render bugs (windows appearing on
walls that don't have them, walls drifting, doors invented) has a
structural cause: Claude vision is guessing 3D facts from 2D pixels
when modern phones can supply that ground truth natively. The May-22
window-hallucination hot-fix (`c6f8137`) is the prompt-layer band-aid;
this section is the proper architectural fix.

**What sensors actually give us**

| Sensor | iOS coverage | Android coverage | Returns |
|---|---|---|---|
| LiDAR | iPhone 12 Pro and later (Pro models only) | Spotty (some Pixel, Samsung S20 Ultra) | Depth map, mesh reconstruction |
| **Apple RoomPlan** (iOS 16+) | LiDAR-equipped iPhones + iPads | Not available | Labelled room model — walls, windows, doors, sofas, beds, tables with 3D bounding boxes + semantic tags. **This is exactly what we're asking Claude to guess.** |
| ARKit / ARCore plane detection | Wide | Wide | Floor + wall planes (no semantic labels) |
| Compass + GPS | Universal | Universal | True north (kills the cardinal-direction-from-photo guesswork) |

**What it solves vs doesn't**

Solves: window/door/wall geometry, room dimensions, furniture inventory
with bounding-box positions, true compass orientation.

Doesn't solve: material identification (LiDAR sees geometry, not
walnut-vs-oak), style judgement, the render itself (still Flux/Kontext).

**Structural constraint**

RoomPlan is iOS-native only — Swift/SwiftUI. WebXR doesn't expose
LiDAR mesh data. myMaison is a Next.js web app, so reaching the sensor
requires one of: a native iOS app, a Capacitor wrapper with a custom
RoomPlan plugin, or a "scan-with-this-companion-app" UX that posts
scan + photo to the existing upload endpoint. The PWA install path
already shipped is the right hook for whichever option wins.

**Phased plan**

- **#149 — vision.ts schema cleanup (no sensor required).**
  - **Step 1 — SHIPPED 2026-05-22.** `light.direction` cardinal enum
    dropped from the analyseRoom schema + system prompt. Consumers
    in `lib/featuring.ts`, `lib/brief/synthesiser.ts`, and the
    DesignerSummaryCard in `components/rooms/upload-form.tsx`
    switched to `light.quality` only. TS type keeps `direction?`
    optional so cached `rooms.analysis` blobs still parse without
    crashing — new analyses won't return the field. `lib/styles.ts`
    + `lib/kontextPrompt.ts` were already scrubbed by c6f8137.
  - **Step 2 — TODO.** Replace with image-space `light.source`
    ("from left" | "from right" | "from above" | "from behind" |
    "indirect" | null) — what Claude CAN actually see from a 2D
    photo.
  - **Step 3 — TODO.** Add explicit `light.window_walls: string[]`
    field describing which walls show windows ("left wall, large
    picture window"; "back wall, two small awnings"). Pre-requisite
    for sensor fusion: the schema needs to express the same facts
    on both sides before reconciliation makes sense.

- **#150 — Native iOS companion or Capacitor wrapper with RoomPlan.**
  Either path produces a USDZ/JSON room model from a 30-60s
  walkthrough scan + the existing photo. Returns both to the upload
  endpoint as a multipart payload (`photo`, `scan`). Capacitor is the
  lower-effort path (re-uses the existing web app shell with a custom
  plugin for RoomPlan); native is more flexibility but more build.
  Estimated effort: 2-3 weeks Capacitor, 4-6 weeks native iOS.

- **#151 — Sensor fusion logic in `/api/analyse-room`.** When scan
  data is present, parse it into the same schema shape as the vision
  analysis output. Then reconcile:
  - Both agree on a chair → confidence 1.0, ship.
  - LiDAR says "chair", Claude says "ottoman" → trust LiDAR for
    geometry / classification, Claude for style + material
    (it's a chair-sized boucle ottoman).
  - LiDAR says window on east wall, Claude omits → trust LiDAR.
    Render prompt builder now has authoritative window-wall data.
  - Scan absent (Android / old iPhone / web) → fall back to
    vision-only, current behaviour.
  The reconciliation result feeds the existing `rooms.analysis` JSON
  with an additional `source: "scan+vision" | "vision-only"` tag so
  downstream consumers can decide whether to trust geometry.

- **#152 — Android ARCore plane-detection fallback (optional).** Less
  rich than RoomPlan (no labelled furniture), but window / door
  geometry from plane edges still beats vision-only. Worth doing for
  AU market Android share (~30-40% depending on segment) — but only
  after iOS proves the fusion architecture is worth it.

**Cross-references**
- The window-hallucination hot-fix (`c6f8137`) is the prompt-layer
  band-aid. #149 is the schema-level fix. #150 + #151 is the proper
  sensor-fusion architecture.
- §6.6 (AR / discovery) is a separate roadmap item — that's about
  *showing* products in AR. This section is about *capturing* the
  room with sensors before the render runs. Different timing, complementary tech.
- The PWA path (already shipped) is the install hook for Capacitor /
  native to feel like one app to the user.
- Cost/benefit shape: this is real native engineering, multi-week
  effort. Right call after closed-beta proves the rendering quality
  and conversion mechanics — not before. Memoed now so the option
  stays visible while we're prioritising the catalogue-intelligence
  work (§6.9).

### 6.11 User preferences (canonical brief)

Closes the cold-start gap when users upload a photo outside a project.
Today the project wizard captures a brief at project-creation time;
outside-project uploads (/rooms/new, /api/analyse-room) have zero user
context, so Claude's recommendation is based on the photo alone.

**Three-layer model with snapshot semantics**

```
User Preferences      ← canonical, edited only on the dashboard
       │
       │ snapshotted on project create
       ▼
Project Brief         ← project-scoped, override cascades to all renders in project
       │
       │ snapshotted per render
       ▼
Per-render override   ← image-scoped, never persists back upward
```

Strict snapshot down the chain — changes to layer N don't affect
already-snapshotted layers above. The ONLY way preferences propagate
upward is by editing them on the dashboard. Explicit user action, never
a side-effect of overriding a project or render.

**Dashboard placement (Option A confirmed):** dedicated section between
`HeroGreeting` and `FeaturedProductsSection`. Visible row, hard to miss,
reinforces "your taste is the foundation of every render".

**Phasing**

- **#153 — Phase A: storage + onboarding + dashboard editor.**
  *Shipped.* Migration `20260522190000_users_preferences.sql` adds the
  `users.preferences jsonb` column. `GET/PUT /api/preferences` are the
  only canonical-write paths. `PreferencesModal` is shared between
  onboarding (first-time, forced-open, "Skip for now" allowed) and
  edit (standard modal). `PreferencesSection` lives on the dashboard
  right below `HeroGreeting` — auto-opens the modal on first visit
  when `preferences IS NULL`. Vocabulary reuses the existing
  `BRIEF_TAG_GROUPS` so user-level prefs and project briefs speak the
  same chip language.

- **#154 — Phase B: project wizard inherits + visible "inherited"
  indicator.** *Shipped.* `POST /api/projects` reads
  `users.preferences.tags` and snapshots them into `projects.brief.tags`
  with `inherited_from_user_prefs: true`. BriefPicker shows the
  "Pre-filled from your preferences" banner when that marker is
  present and the user hasn't toggled anything; the banner hides on
  first chip toggle, the marker gets stripped on first save (existing
  POST behaviour replaces the whole brief shape). Vision-board seeds
  carry the user-pref tags overlaid on the board's other signals
  (palette_signal, style_signal, etc.) rather than replacing them.

- **#155 — Phase C: outside-project upload inherits + per-render
  override.** *Shipped.* `/api/recommend` resolves brief tags by
  strict priority — override → project → user_prefs → [] — and
  returns the source + appliedTags. UploadForm renders a
  RecommendationSourceBanner above the carousels with the chosen
  source's chips + a "Customise →" CTA that opens PreferencesModal
  in `persistMode='per-render'` (no PUT to canonical prefs; tags
  hand back via `onSaveOverride`). "Reset" on override reverts to
  inherited tags by re-firing recommend without overrideTags. The
  per-render override lives in React state only — never persisted.

- **#164 — Phase E: closed-beta coercion of legacy accounts.
  SHIPPED 2026-05-22.** Audit on 2026-05-22 confirmed 4 of 6
  closed-beta accounts had `preferences IS NULL` — pre-existing
  users who never had the chance to onboard because #153 shipped
  after their signup. Their renders were preference-blind: #156
  ranker no-op (empty briefTags), #163 carousel fallback hit only
  the wishlist half. To make today's preference-aware paths
  actually fire for them, the "Skip for now" affordance on the
  first-time `PreferencesModal` was removed. With closed-beta
  locked, the only users hitting `isFirstTime=true` are these
  legacy accounts; they now MUST pick at least one tag before
  dismissing. Backdrop dismiss + Esc were already disabled in
  first-time mode. Edit mode (saved users) keeps the Cancel button
  so users opening their prefs to look but not change are not
  trapped. When public signups open, revisit whether the no-skip
  behaviour stays or becomes a softer "Remind me later" — comment
  in `components/dashboard/preferences-modal.tsx` flags the
  decision point.
- **#157 — Phase D: edge cases + telemetry.** Closed-beta users with
  no `preferences` yet trigger the onboarding modal next login.
  Existing projects with existing briefs are untouched. Log frequency
  of per-render overrides so we can see whether the default
  inheritance is working or users are constantly overriding (signal
  that the canonical prefs need a richer schema). Estimated: ~0.5
  day. (Note: ID renumbered from the original #156 reservation —
  the integer was reused by the shipped prefs ↔ vision_profile
  pre-filter PR. §6.12 picks up the sequence from #158.)

**Cross-references**
- The deferred memory note on "minimal signup, onboarding wizard,
  snapshot prefs onto rooms.analysis and inject into vision +
  designer prompts" is this work — #153 is the first concrete piece.
- The §6.10 sensor fusion path will eventually post scan + photo +
  preferences as a single payload — preferences becomes a stable
  identity layer across both vision-only and sensor-fused uploads.
- The brief synthesiser (`lib/brief/synthesiser.ts`) consumes tags
  today; once #155 lands it gets the same shape from outside-project
  uploads too. No prompt change.

### 6.12 Personalised product universe (per-user curated catalogue)

After #156 every product carries a `vision_profile` (Claude Haiku's read
of materials / colour / tone / quality_tier / palette_fit / room_fit)
and every user carries `preferences.tags` from §6.11. Both vocabularies
project into the same signal space via the deterministic map in
`lib/prefs-vision-fit.ts`. The **intersection** of those two sides IS
the user's catalogue — a materialised subset of the 2,500+ row product
table that fits their declared taste, computed independently of any
room photo.

Today the prefs ↔ vision_profile signal only fires *at render time*,
between SQL fetch and Claude curation (#156). The architectural shift
this section memos: do the narrowing *once per user* and use it for
**two** distinct surfaces.

**Two surfaces, one derivation**

```
User sets preferences           Catalogue grows / changes
       │                                   │
       ▼                                   ▼
  preferences.tags             vision_profile per product
       │                                   │
       └─────────────┬─────────────────────┘
                     │
        user_product_affinity (materialised)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  Dashboard "Your edit"   /api/render candidate pool
   browse surface          ── intersected with this subset
                              BEFORE palette+room SQL fires
```

**What it unlocks**

1. **A new product surface — `Your edit` on the dashboard.** A
   personalised browse view that doesn't require a room photo. "Your
   600 matched products" is a meaningful engagement / shopping surface
   the current architecture can't deliver. It also gives the user a
   tangible payoff for setting preferences, which today are invisible
   except as a downstream prompt input.
2. **Faster, cheaper renders for prefs-set users.** Intersecting the
   palette+room query with the user's affinity set typically takes the
   candidate pool from ~100 down to ~20-40 before Claude Sonnet
   curation runs. That's a smaller prompt (cheaper, faster) and a
   stricter "for you" guarantee. The fallback metadata path also
   benefits — it picks from a pre-narrowed pool that already respects
   the user's avoid list.
3. **An honest "for you" story.** "We've narrowed the catalogue to
   what fits your taste" reads stronger than "we picked some
   palette-matched things and asked Claude to be careful." Same data,
   applied earlier, with a real new surface.

**Phasing**

- **#158 — Phase A: on-the-fly affinity endpoint.** Build
  `lib/user-affinity.ts` extending the deterministic scorer from
  `lib/prefs-vision-fit.ts` so it can rank the *whole* catalogue (not
  just a palette-filtered slice) against a user's preference tags.
  Add `GET /api/user-catalogue` returning the matched list with
  scores, sorted desc, paginated. No materialisation yet — computed
  on request (vision_profile is already in-DB so the query is fast
  enough). Acceptance: endpoint returns < 500 ms for a typical user,
  the score distribution looks sensible (most users land in the
  600-900 range; abstract-preferences users in the 200-400 range).

- **#159 — Phase B: surface in the UI.** Dashboard "Your edit"
  section — top N products grouped by palette or category, image-led
  cards matching the existing FeaturedProductsSection treatment.
  Empty state for users without preferences directs them to the
  onboarding modal. Decide between an inline dashboard block, a new
  `/catalogue?for=me` route, or both. Acceptance: at least one
  surface is live, visibly useful, and updates within a request of a
  preferences edit.

- **#160 — Phase C: materialise + plug into the render pipeline.**
  New table `user_product_affinity (user_id uuid, product_id uuid,
  score smallint, computed_at timestamptz)` with a composite primary
  key + an index on `(user_id, score DESC)`. Recompute triggers:
  `PUT /api/preferences` (synchronous, small — one user's row set),
  scraper's `visionProfile.js` write (async, batched — only affected
  users). `/api/render` joins the palette+room SQL against the
  materialised set when the user has a row, falls back to the full
  catalogue otherwise (preserves current behaviour for cold-start
  users). Acceptance: matcher SQL ~3-5× fewer candidates for
  prefs-set users; no regression for cold-start users.

- **#161 — Phase D: freshness + observability.** Cron job: nightly
  recompute for users whose preferences were edited that day (covers
  any missed triggers). Bulk recompute when `palettes.json` or the
  vision_profile schema versions. Telemetry: log how often a user's
  affinity subset fails to fill a render's category buckets (signal
  that we're over-narrowing). Add a dashboard health line showing
  catalogue freshness per user.

**Open design questions (resolve at #158)**

- **Score visibility.** Showing the user "83% match" reads strong but
  commits to a precision we may not have. Default to ordering desc and
  showing no numbers; revisit if users start asking "why this product
  ahead of that one."
- **Anonymous browsing.** The personalised surface only renders for
  signed-in users with preferences. Anonymous browsing stays on the
  full catalogue (the current behaviour). The empty-state copy on the
  personalised surface promotes sign-up.
- **Abstract avoid slugs.** `avoid:trendy`, `avoid:fussy-patterns`,
  `lifestyle:family-with-kids` etc. still don't project onto a single
  `vision_profile` enum. Acceptable — those continue to feed Claude
  Sonnet's curation reasoning at render time, but they don't shape the
  pre-narrowed user catalogue. The doc surface explains this honestly.

**Cross-references**

- The deterministic scorer (`lib/prefs-vision-fit.ts`) shipped with
  #156 — Phase A's affinity computation extends it from
  per-render-bucket to whole-catalogue.
- Depends on `vision_profile` being comprehensive across all 56
  palettes (the post-2026-05-22 backfill — every product re-scored
  against the Layer 2 / Layer 3 palettes added in `ef147c6` and
  cherry-picked in `ade2461`).
- Builds on §6.11 (user preferences foundation, #153-#157) — this
  section is what makes the canonical brief load-bearing beyond
  prompt-input.
- Complements §6.9 (catalogue intelligence / matcher acceleration) —
  §6.9 is about *which products match this palette+room*; §6.12 is
  about *which products match this user*. They compose: matcher
  filter ∩ user affinity = the candidates Sonnet sees.
- Distinct from #129 (Claude-curated featured products) — that step
  *picks* from a candidate pool; §6.12 *shapes* the pool earlier in
  the pipeline so #129 has less work to do.

### 6.13 Market segment + cross-segment substitution

> *Renumbered from §6.11 during the 2026-05-23 merge with main —
> main's parallel roadmap already uses §6.11 (user preferences) and
> §6.12 (personalised product universe). Ticket numbers #153–#159
> in this section refer to the catalogue-tier rollout and collide
> with the user-preferences phasing under §6.11. Disambiguate via
> commit hash, date, and section context — there is no plan to
> renumber these tickets, but new tickets in this track will start
> from #181 to avoid further collision.*

Catalogue intelligence track for budget context. The premise: a single
flat catalogue treats every user identically, but a first-home-buyer
shopping a $800 sofa and an interior-design client shopping a $4,000
sofa do not want the same picking list. A global user preference for
budget tier filters the catalogue contextually so renders surface
products the user can plausibly afford.

The plumbing landed in #153 (above). Remaining work, in priority order:

- **#154 — Fantastic Furniture scraper. SHIPPED.** Budget tier
  ($400–$1,200 sofas). SAP Commerce Cloud behind Cloudflare (not
  Salesforce as initially guessed); Playwright + cookie warm-up +
  DOM/API dual extraction. 9 canonical categories. See changelog
  for the detail.
- **#155 — Amart Furniture scraper. DEFERRED.** Owner skipped on
  2026-05-22. Budget-mid is currently uncovered (no scraped retailer
  lands there); revisit if the picking-list builder shows a gap for
  users at the $700–$1,500 sofa price point.
- **#156 — IKEA AU scraper. DEFERRED.** Owner skipped on 2026-05-23
  given Fantastic Furniture already covers the same $500–$1,200
  budget price band and IKEA's bot defence would require non-trivial
  stealth tooling. Revisit if the picking list needs Scandinavian-
  styled budget pieces specifically (IKEA's MARKERAD line, the
  Billy/Kallax storage staples, or the LACK occasional tables — none
  of which Fantastic covers).
- **#157 — Brosa scraper. SHIPPED (best-effort, DataDome-gated).**
  Mid tier ($700–$1,500 designer-inspired). Site is fronted by
  DataDome bot protection. Scraper uses vanilla Playwright + homepage
  warm-up + JS-challenge detection (aborts cleanly if challenge
  persists). First live run will confirm whether DataDome lets us
  through. See changelog for the fallback ladder.
- **#158 — Kmart accent scraper. SHIPPED (stools only).** Ultra-
  budget tier. Owner narrowed scope on 2026-05-23 to stools only
  (declined the lamps / small rugs / bedside tables expansion).
  Target dropped from the build at the same time — Wesfarmers
  collapsed most of Target's furniture range into Kmart so the
  duplicate scraper wasn't worth the maintenance. See changelog
  for the Akamai-bypass implementation detail.

Once two or more retailers exist per category, the substitution
feature becomes possible:

- **#159 — Cross-segment similar-products substitution.** Two surfaces:
  (a) catalogue browse — on a product detail page, surface "similar
  at a different price point" cards drawing from neighbouring segments
  (Freedom sofa shows IKEA + Brosa alternatives below); (b) render
  picking-list — on a rendered scene's picking list, every product
  card carries a "swap to cheaper / pricier" toggle that re-runs the
  matcher with a forced segment filter and re-composites the affected
  region using the SKU-fidelity pipeline (#73). Implementation
  prerequisites: the matcher RPCs (#147) need a `market_segment`
  filter parameter; the picking list UI needs a per-item segment
  badge + swap affordance.

  **Why this matters.** Memory [[platform_purpose_products_first]]
  says the picking list is the deliverable. The substitution feature
  is the lever that turns a single render into multiple shopping lists
  at multiple price points — increasing the chance the user actually
  buys something rather than bouncing off "too expensive" pricing.

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
- Palette likes — aggregate-popular carousel + like toggle. `palette_likes`
  table (RLS), POST /api/palettes/[paletteId]/like, PaletteLikeButton
  (optimistic). Dashboard carousel is now top-18 by aggregate likes ∪
  user's liked, sorted lightest→darkest. /palettes gains "Your likes"
  and "Popular" dynamic chips. Migration runs automatically on deploy;
  editorial popular tag seeds the carousel on cold-start.
- Palette catalogue 16 → 56 + popular/all split. New `/palettes`
  browse page with filter chips. Dashboard carousel filtered to the
  18 popular-tagged palettes. Wizard carousel ① defaults to popular
  with a "Show all 56 →" toggle. Existing renders are unaffected —
  no schema changes, all new palettes follow the same role-based
  5-colour structure.
- PWA enablement — manifest + service worker + apple-touch-icon
  shipped so the deployed app installs as a standalone shell from
  iOS Safari (Share → Add to Home Screen). No Capacitor / native
  build yet; this is the lightest path to evaluate the mobile-first
  IA on a real device.
- SKU fidelity (#73) — staging now composites the actual product
  pixels into the room rather than asking Flux to invent something
  matching a text description. Birefnet cutout → sharp composite →
  drop shadow.
- Render revision history (#85) — every staging now persists as a
  versioned revision linked to the parent render. Render page reads
  the active revision; users can revert/roll forward from a strip
  below the before/after slider. Fixes the "staged image vanishes
  when you close the modal" bug.
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
```

Migrations run automatically on deploy — commit the file and push.
No manual `supabase db push` required.

After the migration lands — **update OVERVIEW §4.3** with the new table.

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
