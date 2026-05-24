-- Market-segment tag on every product so a global user preference
-- ("budget", "mid", "premium") can filter the catalogue contextually.
--
-- Six tiers anchored to the AU furniture market. Source of truth for
-- the retailer→segment mapping lives in
-- apps/scraper/utils/retailerSegment.js — keep these two files in sync
-- when adding a retailer. NULL is allowed for catalogues where the
-- concept doesn't apply (e.g. Dulux paint).
--
-- Picking-list / matcher queries will eventually filter
-- `WHERE market_segment = ANY($user_segments)` against the user's
-- preference. Not indexed yet — six-value cardinality means the planner
-- can choose seq-scan; add a partial index if a query slows down.
--
-- The backfill UPDATE matches the retailer strings each scraper writes
-- into `products.retailer`. If a retailer is renamed in the scraper,
-- the backfill needs the matching string here.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS market_segment text;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_market_segment_check;

ALTER TABLE products
  ADD CONSTRAINT products_market_segment_check
  CHECK (market_segment IS NULL OR market_segment IN (
    'ultra-budget',
    'budget',
    'budget-mid',
    'mid',
    'upper-mid',
    'premium'
  ));

UPDATE products SET market_segment = CASE retailer
  WHEN 'Adairs'           THEN 'mid'
  WHEN 'Beacon Lighting'  THEN 'mid'
  WHEN 'Carpet Court'     THEN 'mid'
  WHEN 'Choices Flooring' THEN 'mid'
  WHEN 'Tile Cloud'       THEN 'mid'
  WHEN 'Freedom'          THEN 'upper-mid'
  WHEN 'Koala'            THEN 'upper-mid'
  WHEN 'Poliform'         THEN 'premium'
  WHEN 'Coco Republic'    THEN 'premium'
  WHEN 'GlobeWest'        THEN 'premium'
  WHEN 'Woodcut'          THEN 'premium'
  WHEN 'The Rug Est'      THEN 'premium'
  WHEN 'Signorino'        THEN 'premium'
  WHEN 'ABI Interiors'    THEN 'premium'
  ELSE NULL
END
WHERE market_segment IS NULL;
