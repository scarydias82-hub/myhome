// End-to-end matching pipeline:
//   1. Detect bounding boxes in the rendered image (Florence-2 via fal.ai).
//   2. Crop each box, embed the crop with CLIP (transformers.js local).
//   3. Vector-search products by category, return the top N matches.
//
// We use the service-role Supabase client so the route can RPC into pgvector
// regardless of the calling user.

import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectObjects, dedupeBoxes, categoryForLabel, type Bbox } from '@/lib/detection';
import { embedImage } from '@/lib/embeddings';

export interface PickingMatch {
  productId: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  affiliateUrl: string | null;
  similarity: number;
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
const MIN_BOX_AREA_RATIO = 0.005; // 0.5% of image — discard tiny boxes
// Capped at 5 — fewer parallel HF Inference calls, faster picking-list
// finalise, and the user rarely needs more than 5 shoppable items per
// render anyway (the top picks dominate visual attention).
const MAX_ITEMS = 5;

export async function buildPickingList({
  admin,
  renderImageUrl,
}: {
  admin: SupabaseClient;
  renderImageUrl: string;
}): Promise<MatchResult> {
  // Download the rendered image once — we use it for both detection (via URL)
  // and cropping (via local sharp).
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

  // Fan out crop → embed → vector-search per box. HF Inference cold starts
  // serialise badly (~10s each), so doing this in parallel turns N×10s into
  // ~10s total. Individual failures are isolated — we still return whatever
  // succeeded.
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
  const vec = await embedImage(new Uint8Array(cropBuf));
  const matches = await searchSimilar({ admin, embedding: vec, category });
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

async function searchSimilar({
  admin,
  embedding,
  category,
}: {
  admin: SupabaseClient;
  embedding: number[];
  category: string;
}): Promise<PickingMatch[]> {
  // We use an RPC for pgvector cosine similarity. The function is defined in
  // a migration; falling back to a client-side select would over-fetch.
  const { data, error } = await admin.rpc('match_products', {
    query_embedding: embedding,
    category_filter: category,
    match_count: MATCHES_PER_ITEM,
  });
  if (error) {
    console.error('match_products rpc failed', error);
    return [];
  }
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    retailer: string;
    category: string;
    price_aud: number | null;
    image_url: string;
    product_url: string;
    affiliate_url: string | null;
    similarity: number;
  }>;
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    retailer: r.retailer,
    category: r.category,
    priceAud: r.price_aud,
    imageUrl: r.image_url,
    productUrl: r.product_url,
    affiliateUrl: r.affiliate_url,
    similarity: r.similarity,
  }));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
