// One-shot pass — for every product row that has a vision_profile,
// re-derive the four tag columns from it (#148). Pure DB transform:
// no Claude calls, no image fetches, no costs beyond a sequence of
// UPDATE statements.
//
// Before #148: ingest.js wrote palette_tags / style_tags / room_tags /
// mood_tags using a ΔE76 dominant-colour match against palettes.json
// and a category-based room map. Two sideboards with completely
// different silhouettes that happened to share a dominant brown got
// identical tags.
//
// After #148: vision_profile (Claude Haiku per-image) is the source of
// truth where it's populated. palette_tags = palette_fit keys >= 0.4;
// room_tags = room_fit keys >= 0.4; style_tags / mood_tags derive from
// palette membership via productTags.deriveTags. Rows without
// vision_profile (paint products, broken-image scrapes) keep their
// ingest-derived ΔE76 tags — vision wins where it can, ΔE76 stays as
// the floor.
//
// Invocation:
//   pnpm --filter @myhome/scraper run redrive-tags
//   pnpm --filter @myhome/scraper run redrive-tags -- --dry --limit=20
//   pnpm --filter @myhome/scraper run redrive-tags -- --retailer=globewest

import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { createClient } from '@supabase/supabase-js';
import { tagsFromVisionProfile, VISION_FIT_THRESHOLD } from '../utils/visionTags.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : null;
const retailerArg = process.argv.find((a) => a.startsWith('--retailer='));
const RETAILER_FILTER = retailerArg
  ? retailerArg
      .slice('--retailer='.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const PAGE_SIZE = 500;

console.log(
  `[redrive-tags] mode: ${DRY ? 'DRY (no writes)' : 'LIVE'}${LIMIT ? `, limit ${LIMIT}` : ''}${RETAILER_FILTER ? `, retailer=${RETAILER_FILTER.join(',')}` : ''}`,
);
console.log(`[redrive-tags] fit threshold: ${VISION_FIT_THRESHOLD}`);

let processed = 0;
let updated = 0;
let skippedNoProfile = 0;
let skippedNoChange = 0;
let failed = 0;
let from = 0;

while (true) {
  if (LIMIT && processed >= LIMIT) break;
  const to = LIMIT
    ? Math.min(from + PAGE_SIZE - 1, from + (LIMIT - processed) - 1)
    : from + PAGE_SIZE - 1;

  let q = supabase
    .from('products')
    .select('id, retailer, category, vision_profile, palette_tags, style_tags, room_tags, mood_tags')
    .not('vision_profile', 'is', null)
    .order('id', { ascending: true })
    .range(from, to);
  if (RETAILER_FILTER) q = q.in('retailer', RETAILER_FILTER);

  const { data, error } = await q;
  if (error) {
    console.error('[redrive-tags] page fetch failed', error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    processed++;
    const tags = tagsFromVisionProfile(row.vision_profile, row.category);
    if (!tags) {
      skippedNoProfile++;
      continue;
    }

    // Skip the UPDATE when the derived shape matches what's already on
    // the row — saves write traffic on idempotent re-runs.
    const same =
      arrayEq(tags.palette_tags, row.palette_tags) &&
      arrayEq(tags.room_tags, row.room_tags) &&
      arrayEq(tags.style_tags, row.style_tags) &&
      arrayEq(tags.mood_tags, row.mood_tags);
    if (same) {
      skippedNoChange++;
      continue;
    }

    if (DRY) {
      updated++;
      if (updated <= 5) {
        console.log(
          `  ${row.id.slice(0, 12)}… (${row.category}) palettes=${tags.palette_tags.length} rooms=${tags.room_tags.length} styles=${tags.style_tags.length} moods=${tags.mood_tags.length}`,
        );
      }
      continue;
    }

    const { error: updErr } = await supabase
      .from('products')
      .update({
        palette_tags: tags.palette_tags,
        room_tags: tags.room_tags,
        style_tags: tags.style_tags,
        mood_tags: tags.mood_tags,
      })
      .eq('id', row.id);
    if (updErr) {
      failed++;
      console.error(`  ✗ ${row.id}: ${updErr.message}`);
    } else {
      updated++;
      if (updated <= 5 || updated % 50 === 0) {
        console.log(
          `  ${row.id.slice(0, 12)}… (${row.category}) palettes=${tags.palette_tags.length} rooms=${tags.room_tags.length}`,
        );
      }
    }
  }

  from += data.length;
  if (data.length < PAGE_SIZE) break;
}

console.log('\n=== Summary ===');
console.log(`  processed (rows with vision_profile): ${processed}`);
console.log(`  ${DRY ? 'would-update' : 'updated'}:                          ${updated}`);
console.log(`  skipped (vision_profile unusable):    ${skippedNoProfile}`);
console.log(`  skipped (tags already match):         ${skippedNoChange}`);
console.log(`  failed:                               ${failed}`);

function arrayEq(a, b) {
  if (a == null && (b == null || (Array.isArray(b) && b.length === 0))) return true;
  if (b == null && Array.isArray(a) && a.length === 0) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
