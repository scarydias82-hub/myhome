// Ingest scraped products into Supabase. Reads every output/<retailer>/products.json
// and upserts into public.products by (retailer, sku).
//
// We use the Shopify CDN image URL as the canonical image_url because (a) it's
// already a public, fast CDN, and (b) we keep local copies in output/.../images/
// for backup. For real retailer feeds we'd swap to retailer-hosted URLs.

import 'dotenv/config';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

function toRow(raw) {
  return {
    retailer: raw.retailer,
    sku: raw.id, // we don't have a true SKU yet; the URL slug is unique per retailer.
    name: raw.name,
    category: raw.category || 'Furniture',
    price_aud: raw.price ?? null,
    image_url: raw.images?.source ?? raw.images?.hero ?? '',
    product_url: raw.product_url,
    affiliate_url: null,
    dimensions: raw.dimensions ?? null,
    materials: [],
    colors: [],
    in_stock: true,
    ships_to: ['AU'],
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
const errors = [];

// Reject rows that obviously aren't real products. Earlier scrapes
// captured 404 pages as "products" with name = '404 Not Found' and
// images pointing at site logos / promo banners. Even after fixing the
// scraper, we want a belt-and-braces guard at the ingest step so junk
// can't reach the picking list.
function isJunkRow(row) {
  if (!row.image_url || !row.name) return true;
  if (/404|not\s*found|page\s*not\s*available/i.test(row.name)) return true;
  if (/logo\.svg|product_label|brand|banner/i.test(row.image_url)) return true;
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
console.log(`  total seen:   ${total}`);
console.log(`  upserted:     ${inserted}`);
console.log(`  skipped:      ${skipped}`);
console.log(`  errors:       ${errors.length}`);
if (errors.length > 0) {
  console.log('\nFirst 5 errors:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e.sku}: ${e.error}`);
}
