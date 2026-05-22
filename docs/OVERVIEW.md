# myMaison — overview

The **living source of truth** for the business, the strategy, the system,
the product today, the roadmap, and the how-to for operating it with Claude
Code.

**Last verified:** 2026-05-22 · most recent material commit: `499fab2` (will
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
| **Vision validation + rank**  | Anthropic Claude Haiku 4.5             | Crops each detection and asks Claude to classify (drops anything it reads as architecture, walls, doorways). Then ranks the catalogue against each detection by vision. Replaced an earlier CLIP-based ranker that wouldn't deploy reliably on Vercel. |
| **Designer LLM**              | Anthropic Claude Sonnet 4.6            | Reads the room analysis, the chosen palette, the matched products, and 5–8 RAG chunks from the design-knowledge corpus. Returns the editorial "designer read" shown on the render page. |
| **Room vision analysis**      | Anthropic Claude Haiku 4.5             | One-shot structured JSON from the uploaded room photo: dimensions estimate, light direction, existing materials, architecture features. Cached on `rooms.analysis` so we never re-pay for the same upload. |
| **Catalogue scrapers**        | `apps/scraper`                         | Standalone pnpm app. Coco Republic (BigCommerce sitemap), Poliform (Shopify JSON), GlobeWest (Magento + Playwright). Each scrape writes JSON to `output/<retailer>/`, then `pnpm ingest` (single shared script) runs every product through `utils/paletteMatch.js` (Lab ΔE filter against the 10 app palettes), drops products that match no palette, and upserts to `products` via service role with `palette_tags text[]` populated. ~236 SKUs today. |
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
| `render_revisions` | Version history per render. Original + every staging is one row. `renders.active_revision_id` points at the displayed revision. |
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
