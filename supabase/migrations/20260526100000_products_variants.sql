-- Colour variants on products. Coco Republic publishes one URL per
-- (colour × size) variant — "Marlow Sofa - Charcoal Linen", "Marlow Sofa
-- - Oat Bouclé", etc — and the scraper at apps/scraper/scrapers/
-- cocoRepublic.js:201-214 extracts the variant data into raw.variant.
-- {colour, size}. But the ingest step (apps/scraper/scripts/ingest.js:
-- 39-71) has been discarding that field since launch, so every colour
-- ends up as its own DB row with no sibling-link.
--
-- This migration:
--   1. Adds three columns:
--      - variant_group_id (uuid)  — links siblings of the same product
--      - variant_label    (text)  — display label, e.g. "Charcoal Linen"
--      - colour_hex       (text)  — cached swatch hex for the picker
--                                   card; lifted from existing
--                                   dimensions->>'hex' where present.
--   2. Promotes the existing dominant-colour extraction (paletteMatch.js
--      writes a hex into dimensions.hex at ingest) into the typed
--      colour_hex column. No new vision pass needed.
--   3. Backfills variant_group_id + variant_label for Coco Republic
--      rows by regex on the product name suffix. Conservative: only
--      groups when the suffix LOOKS like a fabric/colour label (Linen,
--      Velvet, Leather, Bouclé, or recognised colour terms). Rows that
--      don't match the heuristic keep NULL group + NULL label — they
--      render as standalone cards in the picker, no harm done.
--
-- The deterministic group_id is a uuid derived from md5(retailer || '|'
-- || name_root). Same hash logic is used in apps/scraper/scripts/
-- ingest.js so future ingests of newly-scraped Coco rows land in the
-- correct existing group automatically — no follow-up backfill needed.

alter table products
  add column if not exists variant_group_id uuid,
  add column if not exists variant_label text,
  add column if not exists colour_hex text;

create index if not exists products_variant_group_id_idx
  on products(variant_group_id);

-- Helper: format an md5 hex digest as a uuid. Postgres uuid_in() rejects
-- raw md5 strings because they lack the canonical hyphen positions, so
-- we slice and reassemble. Marked immutable so it can be used in
-- generated columns / indexed expressions later if needed.
create or replace function md5_uuid(input text) returns uuid as $$
  select (substring(md5(input), 1, 8)  || '-' ||
          substring(md5(input), 9, 4)  || '-' ||
          substring(md5(input), 13, 4) || '-' ||
          substring(md5(input), 17, 4) || '-' ||
          substring(md5(input), 21, 12))::uuid;
$$ language sql immutable;

-- 1. Promote dimensions->>'hex' into colour_hex.
update products
  set colour_hex = dimensions->>'hex'
  where colour_hex is null
    and dimensions ? 'hex';

-- 2. Backfill variant_group_id + variant_label for Coco Republic.
-- Coco names follow the convention "<product> - <colour/material>".
-- We split at the LAST " - " separator, then accept the suffix as a
-- variant_label only if it matches a fabric word or a recognised
-- colour term. Anything else is treated as a different product
-- (e.g. "Floor Lamp", "2 Seater") and stays ungrouped.
with parsed as (
  select
    id,
    retailer,
    name,
    regexp_replace(name, ' - [^-]+$', '') as name_root,
    regexp_replace(name, '^.* - ',     '') as name_suffix
  from products
  where retailer = 'Coco Republic'
    and variant_group_id is null
    and name ~ ' - [^-]+$'
),
filtered as (
  select id, retailer, name_root, name_suffix
  from parsed
  where
    -- Suffix mentions a fabric / material word.
    name_suffix ~* '\m(Linen|Velvet|Leather|Boucle|Bouclé|Wool|Cotton|Silk|Suede|Nubuck|Sheepskin|Cashmere|Mohair|Chenille|Hemp|Jute)\M'
    or
    -- Or starts with a recognised AU furniture-palette colour term.
    name_suffix ~* '^(Charcoal|Sand|Oat|Cream|Ivory|Bone|Stone|Putty|Taupe|Khaki|Sage|Olive|Forest|Navy|Cobalt|Slate|Rust|Terracotta|Camel|Cognac|Walnut|Espresso|Black|White|Grey|Gray|Brown|Tan|Natural|Smoke|Mist|Pewter|Champagne|Caramel|Honey|Ochre|Clay|Sienna|Almond|Linen|Stone|Chalk|Mocha|Sepia|Truffle|Driftwood)( |$)'
)
update products p
set
  variant_group_id = md5_uuid(coalesce(f.retailer, '') || '|' || f.name_root),
  variant_label    = f.name_suffix
from filtered f
where p.id = f.id;
