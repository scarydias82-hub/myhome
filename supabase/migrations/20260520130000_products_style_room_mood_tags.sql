-- Catalog pre-selection metadata.
--
-- We already tag every product with `palette_tags` at ingest (the IDs of
-- palettes its dominant colour belongs to — see paletteMatch.js). The
-- picking-list builder then queries `palette_tags @> ARRAY[$paletteId]`
-- to find products that fit the user's chosen palette.
--
-- Round 17 takes this further: derive style + room + mood tags at ingest
-- so the candidate pool can be pre-filtered to *style-compatible* and
-- *room-appropriate* products before the Claude vision ranker runs. The
-- previous flow asked Haiku to compare a render crop against 8 random
-- candidates in the right category; with these tags the candidates are
-- already culled to the user's aesthetic, so the same 8 slots carry
-- much higher-signal options.
--
-- Where the tags come from (apps/scraper/utils/productTags.js):
--   style_tags = ⋃ palette.style_tags    for every palette in palette_tags
--   room_tags  = ⋃ palette.recommended_rooms ∪ category-implied rooms
--   mood_tags  = ⋃ palette.vibe-tokens    (split on " · ")
--
-- All three are pure derivations from palette_tags + category — no extra
-- Claude vision calls. Backfill apps/scraper/scripts/backfillTags.js
-- updates all existing rows in one pass.
--
-- The matcher in lib/matching.ts is extended to AND these filters on
-- top of the existing palette/category filters when palette + room
-- context is available.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS style_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS room_tags  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mood_tags  text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS products_style_tags_gin
  ON products USING gin (style_tags);

CREATE INDEX IF NOT EXISTS products_room_tags_gin
  ON products USING gin (room_tags);

CREATE INDEX IF NOT EXISTS products_mood_tags_gin
  ON products USING gin (mood_tags);
