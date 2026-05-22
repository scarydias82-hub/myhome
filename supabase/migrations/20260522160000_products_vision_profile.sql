-- Vision-grounded per-product fit signal (#145).
--
-- The current rule-based palette_tags + style_tags + room_tags derivation
-- inherits tags from the palette definitions — two sideboards from
-- different retailers tagged for warm-grounded-earth can look completely
-- different yet score identically because no model has looked at the
-- product image itself. vision_profile fills that gap: a Claude Haiku
-- pre-pass on each product image produces a structured JSON describing
-- the product's silhouette, materials, colour family, visual tone,
-- quality tier, and per-palette + per-room fit scores in [0, 1].
--
-- The matcher refactor (#147) will replace the rule-based palette_tags
-- @> filter with `(vision_profile->'palette_fit'->>$id)::float > 0.6`
-- so the candidate pool is narrowed by what Claude actually sees, not
-- by inherited tag membership. Until #147 lands, the matcher still uses
-- palette_tags — having this column populated is a no-op for current
-- behaviour.
--
-- Shape (documented in apps/scraper/scripts/visionProfile.js):
--   {
--     "silhouette": "<3-8 word physical description>",
--     "materials": ["oak", "boucle", ...],
--     "color_family": "warm-neutral" | "cool-neutral" | ...,
--     "visual_tone": "soft" | "bold" | "moody" | ...,
--     "quality_tier": "budget" | "mid" | "premium",
--     "palette_fit": { "<palette_id>": 0.0..1.0, ... },  -- only >= 0.4
--     "room_fit": { "<room_id>": 0.0..1.0, ... },        -- only >= 0.4
--     "generated_at": "<iso8601>",
--     "model": "claude-haiku-4-5"
--   }
--
-- Backfill: pnpm --filter @myhome/scraper run vision-profile

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vision_profile jsonb;

-- GIN index for any path-based filtering. The matcher's typed
-- `palette_fit->>$id` queries won't use this directly (they need an
-- expression index per palette, deferred until #147 demonstrates the
-- access pattern), but the GIN gives any future `?` / `@>` query a
-- cheap fast path.
CREATE INDEX IF NOT EXISTS products_vision_profile_gin
  ON products USING gin (vision_profile);
