// Claude-vision classification of rug product images. For each Coco
// rug product with a multi-image array, walks image_urls[] and
// classifies each as 'aerial' (flat-lay / top-down rug shot, what
// gpt-image-1 wants as a render reference), 'lifestyle' (rug shown
// in a styled room with surrounding furniture), or 'detail' (close-
// up pile / texture / corner crop). Sets products.preferred_render_
// image_index to the first 'aerial' index found, or NULL if none.
//
// Owner-flagged failure mode (2026-05-26 render): retailers publish
// the lifestyle shot at image_urls[0], gpt-image-1 then renders the
// "rug" with surrounding cushions / lamps / foliage embedded. This
// script + the R3 render-route consumer fix that by routing the
// rendere to the aerial shot when one exists.
//
// Run with:
//   cd apps/scraper
//   node scripts/classifyRugImages.js [--retailer=cocoRepublic]
//                                     [--limit=N]
//                                     [--dry-run]
//
// Costs claude-haiku-4-5 vision: ~$0.0001 per image. Typical Coco
// rug has 5-12 images → ~$0.001/product → ~$0.05 for a 50-rug
// catalogue. Negligible.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY in apps/scraper/.env (vision classification needs it)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const args = process.argv.slice(2);
function strArg(name, fallback) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(`--${name}=`.length) : fallback;
}
function intArg(name, fallback) {
  const v = Number(strArg(name, ''));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
const RETAILER_FILTER = strArg('retailer', 'Coco Republic');
const LIMIT = intArg('limit', 200);
const DRY_RUN = args.includes('--dry-run');

// Rug categories — mirror of FLOOR_COVERING_CATEGORIES in
// apps/web/lib/curation.ts + lib/openai-image.ts.
const RUG_CATEGORIES = ['Rugs', 'Rug', 'Carpet', 'Carpets'];

console.log(
  `[classifyRugImages] retailer=${RETAILER_FILTER} limit=${LIMIT} dry-run=${DRY_RUN}`,
);

// Pull rug products with multi-image arrays. Ordered by id for
// deterministic batching across re-runs.
const productsRes = await supabase
  .from('products')
  .select('id, name, category, image_urls, preferred_render_image_index')
  .eq('retailer', RETAILER_FILTER)
  .in('category', RUG_CATEGORIES)
  .not('image_urls', 'is', null)
  .order('id', { ascending: true })
  .limit(LIMIT);

if (productsRes.error) {
  console.error('product query failed:', productsRes.error.message);
  process.exit(1);
}

const products = (productsRes.data ?? []).filter(
  (p) => Array.isArray(p.image_urls) && p.image_urls.length > 1,
);
console.log(`[classifyRugImages] ${products.length} rug products with multi-image arrays.`);

// System prompt — tight structured classification, no prose.
const SYSTEM = `You are classifying product photography for a rug retailer's catalogue.
For each image, choose ONE label:
  - "aerial"    : top-down or flat-lay view of the rug ALONE, no furniture or styling. The rug fills most of the frame and you can clearly see its full pattern.
  - "lifestyle" : the rug shown in a styled room context, with other furniture / cushions / lamps / plants visible around or on top of the rug.
  - "detail"    : close-up crop of the rug — pile texture, corner, edge binding, or a small section of the pattern. Not the full rug.
  - "other"     : packaging shot, scale diagram, swatch grid, unrelated image.
Reply with the single label only, lowercase, no punctuation.`;

async function classifyImage(imageUrl) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: 'Classify.' },
          ],
        },
      ],
    });
    const text = (message.content[0]?.type === 'text' ? message.content[0].text : '')
      .trim()
      .toLowerCase();
    if (['aerial', 'lifestyle', 'detail', 'other'].includes(text)) {
      return text;
    }
    // Sometimes the model adds explanation despite instructions —
    // grab the first matching word.
    const m = text.match(/\b(aerial|lifestyle|detail|other)\b/);
    return m ? m[1] : 'other';
  } catch (err) {
    console.warn('  classify failed:', err instanceof Error ? err.message : err);
    return 'other';
  }
}

let updated = 0;
let unchanged = 0;
let noAerial = 0;
for (const p of products) {
  const urls = p.image_urls;
  console.log(`\n${p.id.slice(0, 12)}… ${p.name} — ${urls.length} images`);
  let aerialIdx = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (typeof url !== 'string' || !url.startsWith('http')) continue;
    const label = await classifyImage(url);
    console.log(`  [${i}] ${label} · ${url.slice(0, 80)}`);
    if (label === 'aerial' && aerialIdx === null) {
      aerialIdx = i;
      // Don't break — log every image for debugging visibility, but
      // skip further classification API calls to save tokens.
      for (let j = i + 1; j < urls.length; j++) {
        const u = urls[j];
        console.log(`  [${j}] (skipped — first aerial found at ${aerialIdx})`);
      }
      break;
    }
  }
  if (aerialIdx === null) {
    noAerial++;
    console.log(`  → no aerial found; preferred_render_image_index stays NULL`);
    continue;
  }
  if (p.preferred_render_image_index === aerialIdx) {
    unchanged++;
    console.log(`  → preferred_render_image_index already ${aerialIdx}, no update`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`  → would set preferred_render_image_index = ${aerialIdx}`);
    continue;
  }
  const upd = await supabase
    .from('products')
    .update({ preferred_render_image_index: aerialIdx })
    .eq('id', p.id);
  if (upd.error) {
    console.error(`  → update failed: ${upd.error.message}`);
  } else {
    updated++;
    console.log(`  → set preferred_render_image_index = ${aerialIdx}`);
  }
}

console.log(`\n[classifyRugImages] done`);
console.log(`  updated:    ${updated}`);
console.log(`  unchanged:  ${unchanged}`);
console.log(`  no aerial:  ${noAerial}`);
console.log(`  total seen: ${products.length}`);
