// Ingest scraped products into Supabase. Reads every output/<retailer>/products.json
// and upserts into public.products by (retailer, sku).
//
// We use the Shopify CDN image URL as the canonical image_url because (a) it's
// already a public, fast CDN, and (b) we keep local copies in output/.../images/
// for backup. For real retailer feeds we'd swap to retailer-hosted URLs.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { classifyProduct } from '../utils/paletteMatch.js';
import { segmentFor } from '../utils/retailerSegment.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OUTPUT_DIR = path.resolve('output');

// Optional CLI filter: --retailer=adairs,globewest
// Lets us re-ingest just one or two retailers without paying the
// classifyProduct (Claude vision) cost for every other retailer dir.
const retailerArg = process.argv.find((a) => a.startsWith('--retailer='));
const RETAILER_FILTER = retailerArg
  ? new Set(retailerArg.slice('--retailer='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  : null;
if (RETAILER_FILTER) {
  console.log(`[ingest] filtering to retailers: ${[...RETAILER_FILTER].join(', ')}`);
}

// Format an md5 hex digest as a canonical uuid. Mirror of the
// md5_uuid() helper added in migration 20260526100000_products_variants
// — both produce the same uuid for the same input so backfilled rows
// and freshly-ingested ones land in the same variant group without a
// follow-up reconciliation pass.
function md5Uuid(input) {
  const h = createHash('md5').update(input).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Strip a trailing " - <variant suffix>" from a Coco-style product name
// so siblings share the same name_root. Returns null when the name
// doesn't have the separator (single-variant products → no group).
function nameRootFor(name) {
  if (typeof name !== 'string') return null;
  const m = name.match(/^(.+?) - [^-]+$/);
  return m ? m[1].trim() || null : null;
}

function toRow(raw) {
  // Coco-style scrapers populate raw.images.all_sources with every
  // hero source URL the retailer publishes. Older scrapers only
  // surface a single image — leave image_urls NULL for those rows
  // (the migration comment treats NULL as "no multi-image data
  // available", distinct from "[] explicitly empty").
  const imageUrls = Array.isArray(raw.images?.all_sources) && raw.images.all_sources.length > 0
    ? raw.images.all_sources
    : null;

  // Variant data. Coco-style scrapers emit raw.variant.{colour,size};
  // older single-variant scrapers leave the field undefined. The colour
  // label becomes variant_label directly. variant_group_id is derived
  // deterministically from (retailer, name_root) so siblings — same
  // sofa, different fabrics — share a group across ingests AND match
  // the backfill in migration 20260526100000_products_variants.
  const variantLabel = raw.variant?.colour ?? null;
  const nameRoot = nameRootFor(raw.name);
  const variantGroupId = variantLabel && nameRoot
    ? md5Uuid(`${raw.retailer}|${nameRoot}`)
    : null;

  return {
    retailer: raw.retailer,
    sku: raw.id, // we don't have a true SKU yet; the URL slug is unique per retailer.
    name: raw.name,
    category: raw.category || 'Furniture',
    price_aud: raw.price ?? null,
    image_url: raw.images?.source ?? raw.images?.hero ?? '',
    image_urls: imageUrls,
    product_url: raw.product_url,
    affiliate_url: null,
    dimensions: raw.dimensions ?? null,
    materials: [],
    colors: [],
    in_stock: true,
    ships_to: ['AU'],
    // market_segment lands on the row. Prefer what the scraper wrote so
    // a retailer can override per-product later (e.g. an IKEA MARKERAD
    // designer line tagged differently to core range). Fall back to the
    // retailer lookup so older products.json files re-ingest cleanly.
    market_segment: raw.market_segment ?? segmentFor(raw.retailer),
    variant_group_id: variantGroupId,
    variant_label: variantLabel,
    // colour_hex is populated downstream from the classifyProduct call
    // (raw.dimensions.hex is the dominant-colour extraction); see the
    // assignment in the ingest loop below.
    last_seen_at: raw.scraped_at ?? new Date().toISOString(),
  };
}

async function* walkRetailerDirs() {
  let entries;
  try {
    entries = await readdir(OUTPUT_DIR);
  } catch {
    console.error(`Output dir not found at ${OUTPUT_DIR}. Run a scraper first.`);
    process.exit(1);
  }
  for (const name of entries) {
    if (RETAILER_FILTER && !RETAILER_FILTER.has(name.toLowerCase())) continue;
    const dir = path.join(OUTPUT_DIR, name);
    const st = await stat(dir).catch(() => null);
    if (!st?.isDirectory()) continue;
    const file = path.join(dir, 'products.json');
    try {
      const raw = JSON.parse(await readFile(file, 'utf-8'));
      if (Array.isArray(raw)) yield { retailer: name, products: raw };
    } catch {
      console.warn(`skip ${name}: no products.json`);
    }
  }
}

let total = 0;
let inserted = 0;
let skipped = 0;
let skippedPalette = 0;
const errors = [];

// Reject rows that obviously aren't real products. Earlier scrapes
// captured 404 pages as "products" with name = '404 Not Found' and
// images pointing at site logos / promo banners. Even after fixing the
// scraper, we want a belt-and-braces guard at the ingest step so junk
// can't reach the picking list.
function isJunkRow(row) {
  if (!row.name) return true;
  if (/404|not\s*found|page\s*not\s*available/i.test(row.name)) return true;
  // Paint products (Dulux) are legitimately image-less — the swatch
  // hex in dimensions.hex IS the product. The wall-paint picking-list
  // builder special-cases them via lib/matching.ts buildWallPaintItem
  // and renders a coloured swatch in the UI instead of an img tag.
  // Without this exception, the first ingest dropped 186 of 187 Dulux
  // records as junk and broke the wall-paint matcher entirely.
  const hasHex = row.dimensions && typeof row.dimensions === 'object' && row.dimensions.hex;
  if (!row.image_url && !hasHex) return true;
  if (row.image_url && /logo\.svg|product_label|brand|banner/i.test(row.image_url)) return true;
  return false;
}

for await (const { retailer, products } of walkRetailerDirs()) {
  console.log(`\n=== ${retailer} (${products.length} records) ===`);
  for (const raw of products) {
    total++;
    const row = toRow(raw);
    if (isJunkRow(row)) {
      skipped++;
      continue;
    }
    // Palette filter — only products whose dominant colour falls into at
    // least one app palette's tonal family survive. Paint products that
    // already carry dimensions.hex skip the fetch and use the swatch
    // hex directly (Dulux fast path).
    const existingHex = row.dimensions && typeof row.dimensions === 'object'
      ? row.dimensions.hex ?? null
      : null;
    const { hex, tags, styleTags, roomTags, moodTags } = await classifyProduct({
      imageUrl: row.image_url,
      existingHex,
      category: row.category,
    });
    if (tags.length === 0) {
      skippedPalette++;
      continue;
    }
    row.dimensions = { ...(row.dimensions ?? {}), hex };
    row.palette_tags = tags;
    row.style_tags = styleTags;
    row.room_tags = roomTags;
    row.mood_tags = moodTags;
    // colour_hex shadows dimensions.hex as a typed column so the
    // picker card can read it without deserialising the dimensions
    // JSONB. Migration 20260526100000 backfilled existing rows from
    // dimensions->>'hex'; this keeps fresh ingests in sync.
    row.colour_hex = hex ?? null;
    const { error } = await supabase
      .from('products')
      .upsert(row, { onConflict: 'retailer,sku' });
    if (error) {
      errors.push({ sku: row.sku, error: error.message });
      console.error(`  ✗ ${row.sku}: ${error.message}`);
    } else {
      inserted++;
      if (inserted % 25 === 0) console.log(`  ${inserted} upserted…`);
    }
  }
}

console.log('\n=== Summary ===');
console.log(`  total seen:        ${total}`);
console.log(`  upserted:          ${inserted}`);
console.log(`  skipped (junk):    ${skipped}`);
console.log(`  skipped (palette): ${skippedPalette}`);
console.log(`  errors:            ${errors.length}`);
if (errors.length > 0) {
  console.log('\nFirst 5 errors:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e.sku}: ${e.error}`);
}
