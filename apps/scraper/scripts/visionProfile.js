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
//   pnpm --filter @myhome/scraper run vision-profile -- --retailer=globewest
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
const retailerArg = process.argv.find((a) => a.startsWith('--retailer='));
const RETAILER_FILTER = retailerArg
  ? retailerArg
      .slice('--retailer='.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
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

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty image body');
  return { buffer: buf, mediaType: normaliseMediaType(res.headers.get('content-type')) };
}

async function generateProfile(product) {
  const { buffer, mediaType } = await fetchImage(product.image_url);
  const message = await anthropic.messages.create({
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
      if (DRY) return { id: row.id, profile };
      const { error: updErr } = await supabase
        .from('products')
        .update({ vision_profile: profile })
        .eq('id', row.id);
      if (updErr) throw updErr;
      return { id: row.id, profile };
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
        console.error(`  ✗ vision profile failed: ${msg.slice(0, 120)}`);
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
