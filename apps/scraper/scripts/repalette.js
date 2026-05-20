// Re-tag every product's palette_tags + derived style/room/mood
// against the current palette set in apps/web/lib/palettes.json.
//
// Run this after adding new palettes to palettes.json. Each product
// has a cached dominant hex on dimensions.hex (set at original
// ingest) — we re-run tagWithPalettes() against that cached hex
// without re-fetching any product images. Pure DB transform.
//
// Why not just run scraper/scripts/backfillTags.js? That script
// derives style/room/mood FROM the existing palette_tags. If the
// palette set has grown (new palettes added), palette_tags itself
// needs to be recomputed first. This script does both.
//
// Cost: zero — no Claude calls, no fetches. Runs through ~2300 rows
// in 30-60 seconds.
//
// Invoke:
//   pnpm --filter @myhome/scraper exec node scripts/repalette.js
// Flags:
//   --dry        Show counts without writing.
//   --limit=N    Process only the first N rows.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { tagWithPalettes } from '../utils/paletteMatch.js';
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
let unchanged = 0;
let skippedNoHex = 0;
let droppedNoMatch = 0;
let from = 0;

console.log(`[repalette] mode: ${DRY ? 'DRY' : 'LIVE'}${LIMIT ? `, limit ${LIMIT}` : ''}`);

while (true) {
  if (LIMIT && processed >= LIMIT) break;
  const to = LIMIT ? Math.min(from + PAGE_SIZE - 1, from + (LIMIT - processed) - 1) : from + PAGE_SIZE - 1;
  const { data, error } = await supabase
    .from('products')
    .select('id, category, dimensions, palette_tags')
    .order('id', { ascending: true })
    .range(from, to);
  if (error) {
    console.error('[repalette] page fetch failed', error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    processed++;
    const hex = row.dimensions?.hex;
    if (!hex) {
      skippedNoHex++;
      continue;
    }

    const newPaletteTags = tagWithPalettes(hex).sort();
    if (newPaletteTags.length === 0) {
      // Used to match before but doesn't now? Could happen if a
      // narrow palette got removed, though we're only adding here.
      // Don't blank the row — leave existing palette_tags so the
      // picking-list filter still finds it.
      droppedNoMatch++;
      continue;
    }

    const existing = (row.palette_tags ?? []).slice().sort();
    const sameAsExisting =
      existing.length === newPaletteTags.length &&
      existing.every((t, i) => t === newPaletteTags[i]);

    const { style_tags, room_tags, mood_tags } = deriveTags({
      paletteTags: newPaletteTags,
      category: row.category,
    });

    if (DRY) {
      if (!sameAsExisting) {
        updated++;
        if (updated <= 8) {
          console.log(
            `  ${row.id.slice(0, 12)}… (${row.category}) palettes: [${existing.join(',')}] → [${newPaletteTags.join(',')}]`,
          );
        }
      } else {
        unchanged++;
      }
      continue;
    }

    if (sameAsExisting) {
      // Still update style/room/mood in case the derivation logic
      // changed since the last backfill.
      const { error: minorErr } = await supabase
        .from('products')
        .update({ style_tags, room_tags, mood_tags })
        .eq('id', row.id);
      if (minorErr) console.error(`  ✗ ${row.id}: ${minorErr.message}`);
      else unchanged++;
      continue;
    }

    const { error: upErr } = await supabase
      .from('products')
      .update({
        palette_tags: newPaletteTags,
        style_tags,
        room_tags,
        mood_tags,
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`  ✗ ${row.id}: ${upErr.message}`);
    } else {
      updated++;
      if (updated % 100 === 0) console.log(`  ${updated} rows updated…`);
    }
  }

  if (data.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
}

console.log('\n=== Summary ===');
console.log(`  processed:           ${processed}`);
console.log(`  updated (new tags):  ${updated}`);
console.log(`  unchanged:           ${unchanged}`);
console.log(`  skipped (no hex):    ${skippedNoHex}`);
console.log(`  dropped (no match):  ${droppedNoMatch}`);
