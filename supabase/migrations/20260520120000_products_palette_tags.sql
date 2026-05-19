-- Catalog colour-pre-filter.
--
-- Every scraped product runs through apps/scraper/utils/paletteMatch.js
-- at ingest time. We extract a dominant colour from the product image,
-- compare it against every app palette's hexes, and tag the row with
-- the IDs of palettes it could plausibly belong to. Products that
-- match no palette are dropped at ingest — they'd never surface in a
-- picking list anyway, so we don't carry the noise.
--
-- The picking-list builder filters with `palette_tags @> ARRAY[$paletteId]`
-- against the user's selected palette so the catalog query stays fast
-- even as the table grows past a million rows.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS palette_tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS products_palette_tags_gin
  ON products USING gin (palette_tags);
