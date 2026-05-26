// Seed the design_knowledge image RAG (Mode B render context) from
// the multi-image Coco product rows we already have. Coco's rebuilt
// scraper (PR #36) pulls 5-20 hi-res images per product into
// products.image_urls — position 0 is the hero product shot, and
// positions 1+ are typically lifestyle scenes: the sofa in a living
// room, the chair in a styled setting, the rug in a bedroom. Those
// secondary shots ARE the "this is what contemporary Coco looks like"
// reference set we want feeding the Mode B renderer.
//
// Rather than crawl Coco's website separately (DataDome-gated, brittle)
// this script harvests image refs from data we already have in the DB:
//   - Query products where retailer='Coco Republic' AND image_urls
//     length > 1 (multi-image rows only — the hi-res rebuilt set).
//   - For each product, take up to MAX_PER_PRODUCT secondary images
//     (skipping position 0, which is the isolated product shot).
//   - Insert into design_knowledge as image refs:
//       source     = 'coco republic'
//       title      = product name
//       chunk_text = "<name> · <category> — Coco Republic lifestyle"
//                    (short alt-text; Claude interprets the image, the
//                     text is just light captioning)
//       tags       = ['coco', 'contemporary', 'lifestyle', '<category>',
//                     ...product.palette_tags, ...product.room_tags]
//       image_url  = the secondary URL
//
// Idempotent: deletes all rows where source='coco republic' before
// inserting. Safe to re-run after a fresh Coco scrape.
//
// Caveats:
//   - Not every secondary image is a lifestyle scene; some are
//     alternative angles of the product. Acceptable — the renderer
//     consumes multiple refs and Claude leans on the lifestyle ones.
//   - A vision pass to classify "lifestyle vs product angle" would be
//     a future quality lift; not needed for MVP.
//   - The first run is bounded by --limit (default 80) to avoid
//     flooding design_knowledge while we're validating the approach.

import 'dotenv/config';
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

// Defaults can be overridden by CLI flags.
const args = process.argv.slice(2);
function intArg(name, fallback) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  if (!a) return fallback;
  const v = Number(a.slice(`--${name}=`.length));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
const LIMIT = intArg('limit', 80);
const MAX_PER_PRODUCT = intArg('per-product', 2);
const DRY_RUN = args.includes('--dry-run');

console.log(
  `[seedDesignKnowledgeFromCoco] limit=${LIMIT} per-product=${MAX_PER_PRODUCT} dry-run=${DRY_RUN}`,
);

// Pull Coco products that have a multi-image array. Order by name for
// stable selection so the first --limit rows are deterministic across
// runs (helps make dev/prod parity easier to reason about).
const productsRes = await supabase
  .from('products')
  .select('id, name, category, image_urls, palette_tags, room_tags, style_tags, mood_tags')
  .eq('retailer', 'Coco Republic')
  .not('image_urls', 'is', null)
  .order('name', { ascending: true });

if (productsRes.error) {
  console.error('product query failed:', productsRes.error.message);
  process.exit(1);
}

const products = productsRes.data ?? [];
const multiImage = products.filter(
  (p) => Array.isArray(p.image_urls) && p.image_urls.length > 1,
);
console.log(
  `[seedDesignKnowledgeFromCoco] ${products.length} Coco rows total · ${multiImage.length} with multi-image data`,
);

if (multiImage.length === 0) {
  console.warn(
    '[seedDesignKnowledgeFromCoco] no multi-image Coco rows found — run the Coco scraper first (apps/scraper/scrapers/cocoRepublic.js).',
  );
  process.exit(0);
}

// Build the insertion rows. Cap at LIMIT total entries across products.
const rows = [];
let chunkIndex = 0;
for (const p of multiImage) {
  if (rows.length >= LIMIT) break;
  const secondaryImages = (p.image_urls ?? []).slice(1, 1 + MAX_PER_PRODUCT);
  for (const url of secondaryImages) {
    if (rows.length >= LIMIT) break;
    if (typeof url !== 'string' || !url.startsWith('http')) continue;
    const tags = new Set([
      'coco',
      'contemporary',
      'lifestyle',
      (p.category ?? 'furniture').toLowerCase(),
      ...((p.palette_tags ?? []).map((t) => String(t).toLowerCase())),
      ...((p.room_tags ?? []).map((t) => String(t).toLowerCase())),
      ...((p.style_tags ?? []).map((t) => String(t).toLowerCase())),
    ]);
    rows.push({
      source: 'coco republic',
      source_url: null,
      title: p.name,
      chunk_text: `${p.name} · ${p.category ?? 'furniture'} — Coco Republic lifestyle reference`,
      chunk_index: chunkIndex++,
      tags: [...tags].filter(Boolean),
      image_url: url,
    });
  }
}

console.log(`[seedDesignKnowledgeFromCoco] prepared ${rows.length} image-ref rows for insertion.`);

if (DRY_RUN) {
  console.log('--- DRY RUN — first 3 rows:');
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  process.exit(0);
}

// Idempotent: clear the prior Coco refs, then insert fresh. The text-
// only knowledge chunks (source != 'coco republic') are untouched.
const delRes = await supabase
  .from('design_knowledge')
  .delete()
  .eq('source', 'coco republic');
if (delRes.error) {
  console.error('cleanup delete failed:', delRes.error.message);
  process.exit(1);
}
console.log('[seedDesignKnowledgeFromCoco] cleared existing coco republic rows.');

// Batch insert. 500 per batch is well under Supabase's request size cap.
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const insertRes = await supabase.from('design_knowledge').insert(batch);
  if (insertRes.error) {
    console.error(`insert batch ${i}-${i + batch.length} failed:`, insertRes.error.message);
    process.exit(1);
  }
  inserted += batch.length;
  console.log(`  inserted ${inserted}/${rows.length}…`);
}

console.log(`[seedDesignKnowledgeFromCoco] done — ${inserted} image refs in design_knowledge.`);
