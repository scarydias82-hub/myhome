// End-to-end product matching pipeline. We replaced the CLIP+pgvector
// matching step with a Claude-vision ranking step — HF's serverless
// inference for CLIP is unreliable in production and the native ONNX
// runtime won't load on Vercel. Trade-off: ~3-5s per match call versus
// ~10s of HF cold start, plus Claude can reason about *why* a product
// matches (silhouette, palette, material) which the embedding step
// couldn't.
//
// Flow:
//   1. Detect bounding boxes in the rendered image (Florence-2 via fal.ai)
//   2. For each box, pull the top N candidate products from the catalogue
//      by category
//   3. Ask Claude Haiku to rank those candidates by visual similarity to
//      the cropped item from the render
//   4. Return the picking list

import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectObjects, dedupeBoxes, categoryForLabel, type Bbox } from '@/lib/detection';

export interface PickingMatch {
  productId: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  affiliateUrl: string | null;
  similarity: number; // 0..1 normalised from Claude's rank position
}

// bbox values are percentages in [0, 1] so the result page can position
// hotspots without knowing the original image dimensions.
export interface PickingListItem {
  itemLabel: string;
  category: string;
  bbox: { x: number; y: number; w: number; h: number };
  matches: PickingMatch[];
}

export interface MatchResult {
  imageWidth: number;
  imageHeight: number;
  items: PickingListItem[];
}

const MATCHES_PER_ITEM = 5;
// Each ranker call sends 1 crop + N candidate images to Claude Haiku.
// Larger N = more variety per category but a larger Claude payload. 8 is
// the sweet spot between variety and latency for the 60s background
// build window.
const CANDIDATES_PER_ITEM = 8;
// Lowered from 0.005 → 0.002 (0.2% of image) so we catch decor like lamps,
// cushions, vases. They're small in pixels but matter visually.
const MIN_BOX_AREA_RATIO = 0.002;
// Tuned to fit the 60s background build endpoint:
//   - 12 boxes × validator (Haiku, ~3-5s parallel) = ~5s wall-clock
//   - 12 boxes × ranker (Haiku with 8 candidate images, ~5-8s parallel) = ~8s wall-clock
//   - plus Florence-2 detection (~10s) and image fetch (~3s)
//   - total ~26-32s, well inside the 60s envelope
// We previously had this at 15 with 12 candidates which routinely
// pushed past 60s and trapped renders in "running" forever.
const MAX_ITEMS = 12;
const CLAUDE_MODEL = 'claude-haiku-4-5';

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
}

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY missing');
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
}

export async function buildPickingList({
  admin,
  renderImageUrl,
  paletteHexes,
}: {
  admin: SupabaseClient;
  renderImageUrl: string;
  /** Hex codes from the selected style/palette. Used to surface Dulux
   *  paint matches as a "Wall paint" picking-list item. Walls aren't
   *  detectable as discrete objects by Florence-2, so we inject them
   *  here based on the palette the user chose. */
  paletteHexes?: string[];
}): Promise<MatchResult> {
  const imgBuf = Buffer.from(await (await fetch(renderImageUrl)).arrayBuffer());
  const metadata = await sharp(imgBuf).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (!imageWidth || !imageHeight) {
    throw new Error('Could not read render image dimensions');
  }

  const rawBoxes = await detectObjects(renderImageUrl);
  const sized = dedupeBoxes(rawBoxes)
    .filter((b) => (b.w * b.h) / (imageWidth * imageHeight) >= MIN_BOX_AREA_RATIO)
    .slice(0, MAX_ITEMS + 3); // pull a couple extra — validator may drop some
  console.log(
    `[matching] Florence-2 returned ${rawBoxes.length} boxes, ${sized.length} after dedupe+size-filter`,
  );

  // Claude-vision sanity pass: drops architectural false-positives (open
  // doorways read as "mirror", walls read as "art") and corrects mislabels
  // (a bed Florence-2 calls "sofa", a side table called "ottoman").
  const boxes = await validateBoxesWithClaude(imgBuf, sized, imageWidth, imageHeight);
  console.log(
    `[matching] validator kept ${boxes.length}/${sized.length} boxes (labels: ${boxes
      .map((b) => b.label)
      .join(', ')})`,
  );

  const settled = await Promise.allSettled(
    boxes.map((box) => buildPickingItem({ admin, imgBuf, imageWidth, imageHeight, box })),
  );

  const items: PickingListItem[] = [];
  let droppedNoMatches = 0;
  let droppedError = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if (result.value) items.push(result.value);
      else droppedNoMatches++;
    } else {
      droppedError++;
      console.error('matching item failed', result.reason);
    }
  }
  console.log(
    `[matching] final picking list: ${items.length} items (dropped ${droppedNoMatches} for empty catalog matches, ${droppedError} for errors)`,
  );

  // Append a "Wall paint" pseudo-item with Dulux matches if we have a
  // palette to anchor on. Walls aren't detected by Florence-2 (they're
  // surfaces, not objects) so without this the picking list has no
  // paint option at all — even though we have ~108 Dulux colours in
  // the catalogue. The first item in the strip is the highest-leverage
  // choice the user can make, so wall paint goes to the front.
  if (paletteHexes && paletteHexes.length > 0) {
    try {
      const wallItem = await buildWallPaintItem({ admin, paletteHexes });
      if (wallItem) {
        items.unshift(wallItem);
        console.log(`[matching] prepended wall paint item with ${wallItem.matches.length} Dulux matches`);
      }
    } catch (err) {
      console.error('[matching] wall paint item build failed', err);
    }
  }

  return { imageWidth, imageHeight, items };
}

// --- Wall paint matching ----------------------------------------------------
//
// Walls aren't detectable as objects, but we want to surface Dulux paint
// options that match the user's chosen palette. Strategy: take the
// palette's lightest tone as the wall target (palette[0] by convention),
// compute RGB distance against every Dulux paint's swatch hex, return the
// top 5. Distance is Euclidean RGB — perceptually rough, but good enough
// to keep cool tones with cool tones and warm with warm.

async function buildWallPaintItem({
  admin,
  paletteHexes,
}: {
  admin: SupabaseClient;
  paletteHexes: string[];
}): Promise<PickingListItem | null> {
  const targetHex = paletteHexes[0];
  const target = targetHex ? parseHex(targetHex) : null;
  if (!target) {
    console.log('[wall-paint] no usable target hex from palette', paletteHexes);
  }

  // Fetch every Dulux paint we can find. We try in three widening tiers
  // so the picking list always surfaces SOMETHING the user can buy:
  //   1. category='Paint' + retailer='Dulux' + has image
  //   2. drop the image filter
  //   3. broaden to any 'Paint' category (any retailer)
  // Each tier is logged so we can see in Vercel which one fired.
  type PaintRow = {
    id: string;
    name: string;
    retailer: string;
    category: string;
    price_aud: number | null;
    image_url: string | null;
    product_url: string;
    affiliate_url: string | null;
    dimensions: { hex?: string | null } | null;
  };

  let paints: PaintRow[] = [];
  const dulux = await admin
    .from('products')
    .select('id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions')
    .eq('category', 'Paint')
    .eq('retailer', 'Dulux')
    .not('image_url', 'is', null)
    .limit(500);
  if (!dulux.error && dulux.data) paints = dulux.data as PaintRow[];
  console.log(`[wall-paint] tier 1 (Dulux + image): ${paints.length} rows`);

  if (paints.length === 0) {
    const duluxNoImage = await admin
      .from('products')
      .select('id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions')
      .eq('category', 'Paint')
      .eq('retailer', 'Dulux')
      .limit(500);
    if (!duluxNoImage.error && duluxNoImage.data) paints = duluxNoImage.data as PaintRow[];
    console.log(`[wall-paint] tier 2 (Dulux any image): ${paints.length} rows`);
  }
  if (paints.length === 0) {
    const anyPaint = await admin
      .from('products')
      .select('id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions')
      .eq('category', 'Paint')
      .limit(500);
    if (!anyPaint.error && anyPaint.data) paints = anyPaint.data as PaintRow[];
    console.log(`[wall-paint] tier 3 (any retailer Paint): ${paints.length} rows`);
  }

  if (paints.length === 0) {
    console.log('[wall-paint] no paint products in catalogue at any tier');
    return null;
  }

  // Try colour matching first. If we don't have a target or no paints
  // have hex codes, fall back to "first N paints" so the user still
  // sees options — the catalog presence matters more than the perfect
  // shade for surfacing demand.
  let ranked: Array<{ paint: PaintRow }> = [];
  if (target) {
    ranked = paints
      .map((p) => {
        const hex = p.dimensions?.hex;
        if (!hex) return null;
        const rgb = parseHex(hex);
        if (!rgb) return null;
        return { paint: p, distance: rgbDistance(target, rgb) };
      })
      .filter((x): x is { paint: PaintRow; distance: number } => x !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MATCHES_PER_ITEM);
  }
  console.log(`[wall-paint] colour-matched: ${ranked.length} rows`);

  if (ranked.length === 0) {
    // Fallback — no hex codes available (Dulux scrape may have stored
    // the page background colour for every row before the
    // __NEXT_DATA__ extractor was fixed). Surface the first N anyway
    // so the user has paint options to engage with. Demand signal
    // still flows; we re-rank by hex once they're populated.
    ranked = paints.slice(0, MATCHES_PER_ITEM).map((paint) => ({ paint }));
    console.log(`[wall-paint] fallback (no hex match): ${ranked.length} rows`);
  }

  if (ranked.length === 0) return null;

  return {
    itemLabel: 'wall paint',
    category: 'Paint',
    // Heuristic bbox covering the dominant wall band — upper-centre of
    // the image. Without a per-photo wall-region detector, this gets us
    // a hotspot in roughly the right place. The actual paint colour
    // doesn't depend on this bbox (it's a colour-distance match).
    bbox: { x: 0.1, y: 0.15, w: 0.8, h: 0.35 },
    matches: ranked.map((r, position) => ({
      productId: r.paint.id,
      name: r.paint.name,
      retailer: r.paint.retailer,
      category: r.paint.category,
      priceAud: r.paint.price_aud,
      imageUrl: r.paint.image_url ?? '',
      productUrl: r.paint.product_url,
      affiliateUrl: r.paint.affiliate_url,
      // Convert distance into a 0..1 similarity score. Top match = 1.0;
      // we cap the falloff at 0.5 so even the 5th option still reads as
      // "decent match" rather than "no match" in the UI.
      similarity: Math.max(0.5, 1 - position * 0.1),
    })),
  };
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

async function buildPickingItem({
  admin,
  imgBuf,
  imageWidth,
  imageHeight,
  box,
}: {
  admin: SupabaseClient;
  imgBuf: Buffer;
  imageWidth: number;
  imageHeight: number;
  box: Bbox;
}): Promise<PickingListItem | null> {
  const category = categoryForLabel(box.label);
  const cropBuf = await sharp(imgBuf)
    .extract({
      left: clamp(Math.round(box.x), 0, imageWidth - 1),
      top: clamp(Math.round(box.y), 0, imageHeight - 1),
      width: clamp(Math.round(box.w), 1, imageWidth - Math.round(box.x)),
      height: clamp(Math.round(box.h), 1, imageHeight - Math.round(box.y)),
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const candidates = await fetchCandidates({ admin, category });
  const matches = await rankWithClaude(cropBuf, candidates);

  // Items where the catalogue has no SKUs in the detected category are
  // dropped here. We still log the miss as a demand signal so we know
  // which scrapers to prioritise (curtains → Spotlight/Adairs, lighting →
  // Beacon, etc.). Without this filter, the picking list shows empty
  // cards that visually deflate the "every piece is shoppable" promise.
  if (matches.length === 0) {
    console.log(
      `[matching] no catalog matches for ${box.label} (${category}) — demand signal`,
    );
    return null;
  }

  return {
    itemLabel: box.label,
    category,
    bbox: {
      x: box.x / imageWidth,
      y: box.y / imageHeight,
      w: box.w / imageWidth,
      h: box.h / imageHeight,
    },
    matches,
  };
}

async function fetchCandidates({
  admin,
  category,
}: {
  admin: SupabaseClient;
  category: string;
}): Promise<ProductRow[]> {
  // Pull a diverse slate of products in the target category. We sort by
  // price descending to bias toward more representative pieces — cheap
  // accessories can dominate categories like "Lighting" otherwise.
  const { data, error } = await admin
    .from('products')
    .select('id, name, retailer, category, price_aud, image_url, product_url, affiliate_url')
    .eq('category', category)
    .not('image_url', 'is', null)
    .order('price_aud', { ascending: false, nullsFirst: false })
    .limit(CANDIDATES_PER_ITEM);
  if (error) {
    console.error('candidate fetch failed', error);
    return [];
  }
  return (data as ProductRow[]) ?? [];
}

async function rankWithClaude(
  cropBuf: Buffer,
  candidates: ProductRow[],
): Promise<PickingMatch[]> {
  if (candidates.length === 0) return [];

  const client = getAnthropic();
  const cropBase64 = cropBuf.toString('base64');

  const candidateList = candidates
    .map((p, i) => `${i + 1}. ${p.name} — ${p.retailer}`)
    .join('\n');

  // We send the target crop + the candidate images, and ask for an ordered
  // list of the top MATCHES_PER_ITEM ids by visual similarity. Constraints:
  // - keep tokens tight (Haiku is cheap but adds up across boxes)
  // - structured response is just a comma-separated list of 1-based indices
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 60,
    system:
      'You rank interior product photos by visual similarity to a target image. Respond with only a comma-separated list of the candidate numbers ranked from most to least similar. Maximum 5 numbers. No explanation, no markdown, no other text.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'TARGET image (the item to match):' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: cropBase64 },
          },
          { type: 'text', text: `CANDIDATES:\n${candidateList}\n\nTheir images follow in order:` },
          ...candidates.map((p) => ({
            type: 'image' as const,
            source: { type: 'url' as const, url: p.image_url },
          })),
          {
            type: 'text',
            text: `Rank the candidates by visual similarity to the TARGET. Reply with only ${MATCHES_PER_ITEM} comma-separated numbers in order, e.g. "3,1,7,2,5".`,
          },
        ],
      },
    ],
  });

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join(' ')
    .trim();

  const ranked = parseRanking(raw, candidates.length);
  return ranked.slice(0, MATCHES_PER_ITEM).map((idx, position) => {
    const p = candidates[idx];
    if (!p) throw new Error(`Index ${idx} out of bounds`);
    return {
      productId: p.id,
      name: p.name,
      retailer: p.retailer,
      category: p.category,
      priceAud: p.price_aud,
      imageUrl: p.image_url,
      productUrl: p.product_url,
      affiliateUrl: p.affiliate_url,
      // Normalise rank into a 0..1 similarity score (top = 1.0, bottom ~ 0.5).
      similarity: Math.max(0, 1 - position * 0.1),
    };
  });
}

// Claude should reply "3,1,7,2,5" — but sometimes adds dots or words. We
// parse defensively, fall back to natural order if parsing fails.
function parseRanking(raw: string, max: number): number[] {
  const tokens = raw.match(/\d+/g) ?? [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const tok of tokens) {
    const n = Number(tok) - 1; // 1-based → 0-based
    if (n >= 0 && n < max && !seen.has(n)) {
      result.push(n);
      seen.add(n);
    }
  }
  if (result.length === 0) {
    // Fallback: use natural order of candidates
    for (let i = 0; i < Math.min(max, MATCHES_PER_ITEM); i++) result.push(i);
  }
  return result;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// --- Claude vision validation --------------------------------------------
//
// Florence-2 has known weak spots:
//   - open doorways into other rooms read as "mirror" (rectangular dark
//     region with reflections of the next space)
//   - beds read as "sofa" or "couch" depending on bedding cropping
//   - walls / windows occasionally read as "art"
// We send each crop to Claude Haiku and ask it to label or reject. Drops
// architectural false-positives and relabels what Florence-2 got wrong.

// Stage 1: extended with chandelier, sculpture, curtain, sheers, drape,
// planter, wall art. These now make it through the validator and into the
// picking list. Some have empty catalog support today (curtains, sheers,
// drapes — fixed when Stage 3 scrapers land); the matching.ts filter
// drops those with zero matches, so the validator can be liberal.
const VALID_LABELS = new Set([
  'sofa',
  'armchair',
  'chair',
  'dining chair',
  'bench',
  'stool',
  'ottoman',
  'bed',
  'bedside table',
  'coffee table',
  'side table',
  'dining table',
  'console',
  'sideboard',
  'rug',
  'floor lamp',
  'table lamp',
  'desk lamp',
  'pendant light',
  'chandelier',
  'wall light',
  'wall sconce',
  'sconce',
  'ceiling light',
  'ceiling fan',
  'downlight',
  'spotlight',
  'vanity light',
  'mirror',
  'art',
  'wall art',
  'sculpture',
  'plant',
  'planter',
  'vase',
  'cushion',
  'throw',
  'curtain',
  'curtains',
  'sheers',
  'drape',
  'drapes',
]);

async function validateBoxesWithClaude(
  imgBuf: Buffer,
  boxes: Bbox[],
  imageWidth: number,
  imageHeight: number,
): Promise<Bbox[]> {
  if (boxes.length === 0) return [];

  const settled = await Promise.allSettled(
    boxes.map(async (box) => {
      const cropBuf = await sharp(imgBuf)
        .extract({
          left: clamp(Math.round(box.x), 0, imageWidth - 1),
          top: clamp(Math.round(box.y), 0, imageHeight - 1),
          width: clamp(Math.round(box.w), 1, imageWidth - Math.round(box.x)),
          height: clamp(Math.round(box.h), 1, imageHeight - Math.round(box.y)),
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      const verdict = await classifyCropWithClaude(cropBuf, box.label);
      return { box, verdict };
    }),
  );

  const out: Bbox[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const { box, verdict } = r.value;
    if (verdict.kind === 'drop') continue;
    out.push({ ...box, label: verdict.label });
  }
  return out;
}

type Verdict =
  | { kind: 'keep'; label: string }
  | { kind: 'drop'; reason: string };

async function classifyCropWithClaude(cropBuf: Buffer, _hint: string): Promise<Verdict> {
  try {
    const client = getAnthropic();
    const cropBase64 = cropBuf.toString('base64');
    const allowed = [...VALID_LABELS].join(', ');
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 30,
      system: `You classify a cropped region of an interior photo. Reply with EXACTLY ONE token from this list, no other words:
${allowed}, architecture, other

Use "architecture" if the region is a doorway, an opening into another room, a wall section, a window, a ceiling, or any structural element — NOT a piece of furniture or decor. A reflection visible through an open doorway is NOT a mirror; reply "architecture".
Use "other" for anything that isn't furniture, decor, or architecture (a person, an animal, etc.).
Otherwise pick the closest match from the list — but pick it from what YOU see in the image, not from any prior label. Be especially careful with chair-vs-bedside-table and sofa-vs-bed — short pieces with cushions tend to read as armchairs even when they're actually bedside tables or stools.`,
      messages: [
        {
          // Deliberately do NOT pass the Florence-2 hint here. The
          // previous prompt anchored Claude to whatever Florence-2 had
          // guessed, which made the validator a rubber stamp on
          // labels like "armchair" that were actually bedside tables.
          role: 'user',
          content: [
            { type: 'text', text: 'What is this cropped region of an interior photo?' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: cropBase64 },
            },
          ],
        },
      ],
    });
    const raw = message.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join(' ')
      .toLowerCase()
      .trim()
      .replace(/[.,]$/, '');
    if (raw === 'architecture') return { kind: 'drop', reason: 'architecture' };
    if (raw === 'other') return { kind: 'drop', reason: 'other' };
    if (VALID_LABELS.has(raw)) return { kind: 'keep', label: raw };
    // Couldn't parse — trust Florence-2's original guess.
    return { kind: 'keep', label: _hint };
  } catch (err) {
    console.error('validator call failed, keeping original label', err);
    return { kind: 'keep', label: _hint };
  }
}
