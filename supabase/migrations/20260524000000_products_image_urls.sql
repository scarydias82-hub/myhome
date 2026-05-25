-- Multi-image storage for products that publish multiple hero shots
-- (lifestyle, detail, scale, alt-angle). The existing `image_url` text
-- column stays as the canonical primary image — the front-end uses it
-- for cards, carousels, and the picking-list — and this new array
-- carries the rest in display order (image_urls[0] always equals
-- image_url for rows scraped after this migration).
--
-- Populated by scrapers that surface multiple per-product images
-- (Coco Republic is the first; future high-end retailers will
-- follow the same pattern). Other scrapers continue writing only
-- `image_url` and `image_urls` stays NULL for those rows — no
-- backfill needed, the empty array semantic matches "single image"
-- via downstream length checks.
--
-- Downstream consumers:
--   - Future cross-segment substitution UI (#159, §6.13) can show
--     multiple angles when the user opens a product card
--   - Future render-substitution flow (§6.13) can pick the best
--     angle for compositing into the rendered scene
--   - Vision profile (scripts/visionProfile.js) continues using
--     `image_url` only — running Haiku once per product is the right
--     economics, not once per angle

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls text[];

COMMENT ON COLUMN products.image_urls IS
  'Ordered list of all hero/lifestyle/detail image URLs the retailer publishes for this product. NULL for retailers that surface only a single image. image_urls[0] always equals image_url for rows where this is populated.';
