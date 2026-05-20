// Backfill style_tags / room_tags / mood_tags for every row currently
// in `products` that has at least one palette_tag set.
//
// Pure DB transform: we read palette_tags + category from the row, run
// productTags.deriveTags(), and update the three new columns. No image
// fetches, no Claude calls — runs in a single pass over the table in
// page-sized batches.
//
// Invoke with the same env vars as ingest.js:
//   pnpm --filter @myhome/scraper exec node scripts/backfillTags.js
//
// Optional flags:
//   --dry        Show counts without writing.
//   --limit=N    Process only the first N rows (for sanity checks).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { deriveTags } from '../utils/productTags.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : null;

const PAGE_SIZE = 500;

let processed = 0;
let updated = 0;
let skipped = 0;
let from = 0;

console.log(`[backfill] mode: ${DRY ? 'DRY (no writes)' : 'LIVE'}${LIMIT ? `, limit ${LIMIT}` : ''}`);

while (true) {
  if (LIMIT && processed >= LIMIT) break;
  const to = LIMIT ? Math.min(from + PAGE_SIZE - 1, from + (LIMIT - processed) - 1) : from + PAGE_SIZE - 1;
  const { data, error } = await supabase
    .from('products')
    .select('id, category, palette_tags')
    .order('id', { ascending: true })
    .range(from, to);
  if (error) {
    console.error('[backfill] page fetch failed', error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    processed++;
    const palette_tags = row.palette_tags ?? [];
    if (palette_tags.length === 0) {
      skipped++;
      continue;
    }
    const { style_tags, room_tags, mood_tags } = deriveTags({
      paletteTags: palette_tags,
      category: row.category,
    });

    if (DRY) {
      updated++;
      if (updated <= 5) {
        console.log(
          `  ${row.id.slice(0, 12)}… (${row.category}) palettes=${palette_tags.length} → style=${style_tags.length} room=${room_tags.length} mood=${mood_tags.length}`,
        );
      }
      continue;
    }

    const { error: updErr } = await supabase
      .from('products')
      .update({ style_tags, room_tags, mood_tags })
      .eq('id', row.id);
    if (updErr) {
      console.error(`  ✗ ${row.id}: ${updErr.message}`);
    } else {
      updated++;
      if (updated % 100 === 0) console.log(`  ${updated} rows updated…`);
    }
  }

  if (data.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
}

console.log('\n=== Summary ===');
console.log(`  processed:        ${processed}`);
console.log(`  updated:          ${updated}`);
console.log(`  skipped (no pal): ${skipped}`);
