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
const CANDIDATES_PER_ITEM = 10; // how many products to send to Claude per match
const MIN_BOX_AREA_RATIO = 0.005;
const MAX_ITEMS = 5;
const CLAUDE_MODEL = 'claude-haiku-4-5'; // cheaper than Sonnet for this ranking task

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
}: {
  admin: SupabaseClient;
  renderImageUrl: string;
}): Promise<MatchResult> {
  const imgBuf = Buffer.from(await (await fetch(renderImageUrl)).arrayBuffer());
  const metadata = await sharp(imgBuf).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (!imageWidth || !imageHeight) {
    throw new Error('Could not read render image dimensions');
  }

  const rawBoxes = await detectObjects(renderImageUrl);
  const boxes = dedupeBoxes(rawBoxes)
    .filter((b) => (b.w * b.h) / (imageWidth * imageHeight) >= MIN_BOX_AREA_RATIO)
    .slice(0, MAX_ITEMS);

  const settled = await Promise.allSettled(
    boxes.map((box) => buildPickingItem({ admin, imgBuf, imageWidth, imageHeight, box })),
  );

  const items: PickingListItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) items.push(result.value);
    else if (result.status === 'rejected') {
      console.error('matching item failed', result.reason);
    }
  }

  return { imageWidth, imageHeight, items };
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
