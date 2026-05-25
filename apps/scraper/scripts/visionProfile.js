// Vision-grounded per-product fit signal (#145).
//
// For every products row that has an image_url and no vision_profile
// (or --rebuild), this script:
//   1. Fetches the product image
//   2. Calls Claude Haiku with the image + a structured-extraction prompt
//      that includes a one-line summary of every app palette
//   3. Parses the response into the vision_profile JSON shape
//   4. Writes it back to the row
//
// The matcher refactor (#147) consumes `palette_fit` and `room_fit` to
// narrow the candidate pool by what Claude actually sees in the product
// image, replacing the current rule-based palette_tags inheritance.
//
// Resumable: skips rows that already have vision_profile unless --rebuild.
// Concurrency: capped at 4 workers (Haiku rate-limit headroom).
// Cost: ~$0.005-0.012 per product (Haiku vision @ ~600 in / ~700 out
// tokens, system block prompt-cached after first call). The full
// catalogue (~3,000 rows) lands at $15-30 one-off.
//
// Invocation:
//   pnpm --filter @myhome/scraper run vision-profile
//   pnpm --filter @myhome/scraper run vision-profile -- --dry --limit=10
//   pnpm --filter @myhome/scraper run vision-profile -- --retailer=GlobeWest
//   pnpm --filter @myhome/scraper run vision-profile -- --retailer="Coco Republic"
//   pnpm --filter @myhome/scraper run vision-profile -- --rebuild

// override:true so the .env file is authoritative — some dev shells
// export empty ANTHROPIC_API_KEY values that would otherwise win.
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { tagsFromVisionProfile } from '../utils/visionTags.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error(
    'Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in apps/scraper/.env',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ---- CLI flags -------------------------------------------------------------

const DRY = process.argv.includes('--dry');
const REBUILD = process.argv.includes('--rebuild');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : null;
// --retailer values are matched case-and-space-sensitively against
// products.retailer (which is stored in the canonical mixed-case form
// the scraper writes: "Coco Republic", "GlobeWest", "Fantastic
// Furniture", etc.). Quote multi-word names in the shell:
//   --retailer="Coco Republic,GlobeWest"
const retailerArg = process.argv.find((a) => a.startsWith('--retailer='));
const RETAILER_FILTER = retailerArg
  ? retailerArg
      .slice('--retailer='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const PAGE_SIZE = 200;
const CONCURRENCY = 4;
const MODEL = 'claude-haiku-4-5';
const FIT_THRESHOLD = 0.4; // omit scores below this from the JSON

// ---- Palette + room vocabularies ------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const palettesJson = JSON.parse(
  await readFile(path.resolve(__dirname, '../../web/lib/palettes.json'), 'utf-8'),
);
const PALETTES = palettesJson.palettes;

// Compact one-line palette descriptor for the system prompt. Keeps tokens
// tight (~50 chars × 56 palettes ≈ 700 tokens) while giving Claude enough
// of each palette's vibe + style hooks to score reasonably. The prompt-
// cache amortises this cost across all calls in the run.
function paletteDescriptor(p) {
  const styleHook = (p.style_tags ?? []).slice(0, 3).join('/') || 'neutral';
  const vibe = (p.vibe ?? '').slice(0, 60);
  return `  ${p.id}: ${styleHook} — ${vibe}`;
}
const PALETTE_BLOCK = PALETTES.map(paletteDescriptor).join('\n');

const ROOM_TYPES = [
  'living_room',
  'bedroom',
  'dining_room',
  'kitchen',
  'bathroom',
  'study',
  'outdoor',
  'hallway',
];

// ---- System prompt --------------------------------------------------------

const SYSTEM = `You are myMaison's catalogue intelligence pre-pass. You see a single product image (furniture, lighting, rug, decor, paint, tile, etc.) and must produce a structured vision profile that the render-time matcher will use to narrow candidate products by visual fit.

Output ONE JSON object inside a fenced code block. No prose, no commentary.

REQUIRED FIELDS

1. silhouette (string, 3-8 words) — short physical description grounded in what you see, e.g. "low-slung mid-century armchair with tubular frame", "boucle modular sofa with deep seat". Avoid retailer/style jargon; describe shape + form.

2. materials (string[], 1-4 items) — visible materials. Pick from: oak, walnut, ash, teak, pine, brass, chrome, steel, marble, travertine, terrazzo, ceramic, glass, leather, linen, boucle, velvet, cotton, wool, rattan, cane, woven, lacquer, painted. Add others only if none fit.

3. color_family (string, exactly one of) — warm-neutral | cool-neutral | earth | jewel | pastel | monochrome | metallic | vibrant

4. visual_tone (string, exactly one of) — soft | bold | moody | fresh | warm | cool | quiet

5. quality_tier (string, exactly one of) — budget | mid | premium. Read this from the photo: lighting + composition + perceived craftsmanship. Be honest; not every piece is premium.

6. palette_fit (object, palette_id → 0.0-1.0) — for each palette the product would plausibly belong to, score it 0.0-1.0. 1.0 = "this product is the hero of that palette"; 0.6 = "would slot in cleanly"; 0.4 = "could work as an accent". OMIT palettes scoring below 0.4. Most products fit 2-6 palettes well. Be discerning — a beige boucle armchair belongs to several warm-neutral palettes; a chrome chandelier belongs to a much narrower set.

7. room_fit (object, room → 0.0-1.0) — for each room the product would naturally belong in, score 0.0-1.0. OMIT rooms scoring below 0.4. Rooms: living_room, bedroom, dining_room, kitchen, bathroom, study, outdoor, hallway. A sofa is mainly living_room (high) with a tail in study; a vanity tap is bathroom only.

THE PALETTE CATALOGUE (id: style hooks — vibe)

${PALETTE_BLOCK}

Output shape:

\`\`\`json
{
  "silhouette": "...",
  "materials": ["..."],
  "color_family": "...",
  "visual_tone": "...",
  "quality_tier": "...",
  "palette_fit": { "<palette_id>": 0.0 },
  "room_fit": { "<room>": 0.0 }
}
\`\`\``;

// ---- Image fetch + Claude call --------------------------------------------

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normaliseMediaType(raw) {
  if (!raw) return 'image/jpeg';
  const t = raw.split(';')[0].trim().toLowerCase();
  return ALLOWED_MEDIA_TYPES.has(t) ? t : 'image/jpeg';
}

// Anthropic vision caps: 5MB per image and 8000px on any dimension.
// Tile / flooring / carpet scrapes routinely store 8-15MB swatches that
// blow past both limits and produce 400 invalid_request_error responses.
// Pre-resize everything to a safe ceiling — JPEG quality 85, max edge
// 1568px (matches Anthropic's recommended sweet spot for vision tokens).
const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 85;

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length === 0) throw new Error('empty image body');

  // Re-encode through sharp regardless of source format: caps dimensions,
  // strips EXIF, normalises to JPEG. sharp also catches malformed bytes
  // here with a clear error rather than letting Anthropic reject them.
  try {
    const resized = await sharp(raw)
      .rotate() // honour EXIF orientation before stripping the tag
      .resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { buffer: resized, mediaType: 'image/jpeg' };
  } catch (err) {
    throw new Error(`image decode/resize failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Retry-with-backoff on transient Anthropic errors (529 overloaded,
// 503 unavailable, 429 rate-limited). The scraper isn't under a 60s
// Vercel ceiling so we can afford long waits — 529 floods cleared up
// to background levels in well under a minute during the May-22 outage.
function isRetryableAnthropicError(err) {
  const status = err?.status ?? err?.response?.status;
  const errorType = err?.error?.type ?? err?.type;
  if (status === 529 || status === 503 || status === 429) return true;
  if (errorType === 'overloaded_error' || errorType === 'rate_limit_error') return true;
  if (typeof err?.message === 'string' && /overload|rate.?limit|temporar/i.test(err.message)) {
    return true;
  }
  return false;
}

async function callAnthropicWithRetry(params) {
  // Six attempts at 0/3/8/20/45/90s — total ~165s of patience. Anthropic
  // overload events typically clear inside the first three retries; the
  // long tail catches the rare 5+ minute capacity slumps.
  const delays = [0, 3000, 8000, 20000, 45000, 90000];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      lastErr = err;
      if (!isRetryableAnthropicError(err) || i === delays.length - 1) {
        throw err;
      }
      const next = delays[i + 1];
      console.warn(`  ↻ retryable error (${err?.status ?? err?.error?.type ?? 'unknown'}), backing off ${next}ms`);
    }
  }
  throw lastErr;
}

async function generateProfile(product) {
  const { buffer, mediaType } = await fetchImage(product.image_url);
  const message = await callAnthropicWithRetry({
    model: MODEL,
    max_tokens: 1500,
    // Cache the system block — same across every product in the run, so
    // Anthropic prompt-cache should hit on every call after the first.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
          },
          {
            type: 'text',
            text: `Product: ${product.name} (${product.retailer} · ${product.category}). Profile this image. Return JSON only.`,
          },
        ],
      },
    ],
  });

  const raw = message.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  // Validate + prune to the documented shape. Trust-but-verify Claude's
  // output so a hallucinated palette_id or out-of-range score can't
  // corrupt the matcher downstream.
  const palette_fit = pruneFitMap(parsed.palette_fit, new Set(PALETTES.map((p) => p.id)));
  const room_fit = pruneFitMap(parsed.room_fit, new Set(ROOM_TYPES));

  return {
    silhouette: typeof parsed.silhouette === 'string' ? parsed.silhouette.slice(0, 200) : '',
    materials: Array.isArray(parsed.materials)
      ? parsed.materials.slice(0, 6).filter((m) => typeof m === 'string')
      : [],
    color_family: typeof parsed.color_family === 'string' ? parsed.color_family : null,
    visual_tone: typeof parsed.visual_tone === 'string' ? parsed.visual_tone : null,
    quality_tier: typeof parsed.quality_tier === 'string' ? parsed.quality_tier : null,
    palette_fit,
    room_fit,
    generated_at: new Date().toISOString(),
    model: MODEL,
  };
}

function pruneFitMap(raw, allowedKeys) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowedKeys.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < FIT_THRESHOLD) continue;
    out[k] = Math.min(1, Math.max(0, Number(n.toFixed(2))));
  }
  return out;
}

// ---- Concurrency-bounded worker pool --------------------------------------

async function settledWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---- Main loop ------------------------------------------------------------

console.log(
  `[vision-profile] mode: ${DRY ? 'DRY (no writes)' : 'LIVE'}${REBUILD ? ', --rebuild' : ''}${LIMIT ? `, limit ${LIMIT}` : ''}${RETAILER_FILTER ? `, retailer=${RETAILER_FILTER.join(',')}` : ''}`,
);
console.log(`[vision-profile] model: ${MODEL}, concurrency: ${CONCURRENCY}, palettes: ${PALETTES.length}`);

let processed = 0;
let updated = 0;
let skippedNoImage = 0;
let skippedAlreadyDone = 0;
let failed = 0;
let from = 0;

while (true) {
  if (LIMIT && processed >= LIMIT) break;
  const to = LIMIT
    ? Math.min(from + PAGE_SIZE - 1, from + (LIMIT - processed) - 1)
    : from + PAGE_SIZE - 1;

  let q = supabase
    .from('products')
    .select('id, retailer, name, category, image_url, vision_profile')
    .order('id', { ascending: true })
    .range(from, to);
  if (RETAILER_FILTER) q = q.in('retailer', RETAILER_FILTER);

  const { data, error } = await q;
  if (error) {
    console.error('[vision-profile] page fetch failed', error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  // Filter to rows that need work in THIS page (resume + image presence).
  const todo = data.filter((row) => {
    if (!row.image_url) {
      skippedNoImage++;
      return false;
    }
    if (!REBUILD && row.vision_profile) {
      skippedAlreadyDone++;
      return false;
    }
    return true;
  });

  if (todo.length > 0) {
    const settled = await settledWithConcurrency(todo, CONCURRENCY, async (row) => {
      const profile = await generateProfile(row);
      // Derive the four tag columns from the same profile so the
      // catalogue stays in lock-step. tagsFromVisionProfile uses the
      // shared 0.4 fit threshold and the productTags.deriveTags
      // palette-union for style + mood. See apps/scraper/utils/
      // visionTags.js for the rule + apps/scraper/scripts/
      // redeRiveTagsFromVisionProfile.js for the matching one-shot
      // pass over rows that were profiled before this extension landed.
      const derivedTags = tagsFromVisionProfile(profile, row.category);
      if (DRY) return { id: row.id, profile, derivedTags };
      const update = { vision_profile: profile };
      if (derivedTags) {
        update.palette_tags = derivedTags.palette_tags;
        update.room_tags = derivedTags.room_tags;
        update.style_tags = derivedTags.style_tags;
        update.mood_tags = derivedTags.mood_tags;
      }
      const { error: updErr } = await supabase
        .from('products')
        .update(update)
        .eq('id', row.id);
      if (updErr) throw updErr;
      return { id: row.id, profile, derivedTags };
    });

    for (const result of settled) {
      processed++;
      if (result.status === 'fulfilled') {
        updated++;
        const p = result.value.profile;
        const paletteCount = Object.keys(p.palette_fit).length;
        const roomCount = Object.keys(p.room_fit).length;
        if (updated <= 5 || updated % 25 === 0) {
          console.log(
            `  ${result.value.id.slice(0, 12)}… ${p.silhouette.slice(0, 50)} (palettes: ${paletteCount}, rooms: ${roomCount})`,
          );
        }
      } else {
        failed++;
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        // Show the full message so 400 image-too-large / image-decode
        // errors stay readable. Cap at 400 chars for the rare case where
        // Anthropic returns a long stack trace, but don't truncate the
        // meaningful portion of the response body.
        console.error(`  ✗ vision profile failed: ${msg.slice(0, 400)}`);
      }
    }
  }

  from += data.length;
  if (data.length < PAGE_SIZE) break;
}

console.log('\n=== Summary ===');
console.log(`  processed (with image, needed work): ${processed}`);
console.log(`  vision profiles ${DRY ? 'would be ' : ''}written: ${updated}`);
console.log(`  skipped (no image_url):              ${skippedNoImage}`);
console.log(`  skipped (already done, --rebuild to force): ${skippedAlreadyDone}`);
console.log(`  failed:                              ${failed}`);
