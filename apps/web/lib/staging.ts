// Virtual staging. Places the user's selected catalogue product into
// their actual room photo by COMPOSITING the product's pixels (after
// background removal) onto the room — not by asking Flux to invent
// something matching a text description.
//
// Previous implementation (Flux Pro Fill with prompt + mask) had no
// way to see the product image, so the user picked a marble coffee
// table and got back "a coffee table" — generic, not theirs. The
// composite pipeline puts the SKU pixels in the scene directly.
//
// Pipeline:
//   1. Caller provides the picking-list bbox in percentage space.
//   2. We download the room photo and the product image, background-
//      remove the product via fal birefnet.
//   3. Sharp resizes the cutout to fit the bbox while preserving the
//      product's aspect ratio, drops it in with a soft shadow.
//   4. Upload composite to the renders bucket, log staged_images row,
//      return URL. The revision system (lib/revisions.ts) picks it up
//      from there.

import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cutoutProduct,
  compositeProductIntoRoom,
  compositeMultipleProducts,
  harmoniseComposite,
  type PixelBbox,
} from '@/lib/composite';

export interface StagingProduct {
  name: string;
  category: string;
  retailer: string;
  imageUrl?: string | null;
  colors?: string[];
  materials?: string[];
}

export interface StagingResult {
  imageUrl: string;
  prompt: string;
  stagedImageId: string | null;
  storageKey: string | null;
}

export interface StagingInput {
  admin: SupabaseClient;
  roomPhotoKey: string;
  bbox: { x: number; y: number; w: number; h: number };
  product: StagingProduct;
  productId: string;
  userId: string;
  renderId: string;
  itemIndex: number;
  projectId: string | null;
}

export async function stageProduct({
  admin,
  roomPhotoKey,
  bbox,
  product,
  productId,
  userId,
  renderId,
  itemIndex,
  projectId,
}: StagingInput): Promise<StagingResult> {
  if (!product.imageUrl) {
    throw new Error(
      `Cannot stage ${product.name}: no product image URL on file. Scrape the retailer again.`,
    );
  }

  // 1. Load the room photo + read dimensions.
  const photoBuf = await downloadRoom(admin, roomPhotoKey);
  const { width, height } = await readDims(photoBuf);

  // 2. Background-remove the product image so we have transparent pixels.
  const cutout = await cutoutProduct(product.imageUrl);

  // 3. Composite into the room photo at the bbox region.
  const pixelBbox = toPixelBbox(bbox, width, height);
  const compositeBuf = await compositeProductIntoRoom({
    roomBuf: photoBuf,
    productCutoutBuf: cutout,
    bbox: pixelBbox,
  });

  // 4. Persist + insert staged_images row.
  const label = buildStagingLabel([product]);
  const { imageUrl, storageKey, stagedImageId } = await persistComposite({
    admin,
    composite: compositeBuf,
    userId,
    renderId,
    projectId,
    productId,
    productIds: [productId],
    itemIndex,
    label,
  });

  return { imageUrl, prompt: label, stagedImageId, storageKey };
}

export interface MultiStageItem {
  productId: string;
  product: StagingProduct;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface MultiStageInput {
  admin: SupabaseClient;
  roomPhotoKey: string;
  userId: string;
  renderId: string;
  projectId: string | null;
  items: MultiStageItem[];
}

export async function stageMultipleProducts({
  admin,
  roomPhotoKey,
  userId,
  renderId,
  projectId,
  items,
}: MultiStageInput): Promise<StagingResult> {
  if (items.length === 0) throw new Error('stageMultipleProducts: no items');

  const missing = items.filter((it) => !it.product.imageUrl);
  if (missing.length > 0) {
    throw new Error(
      `Cannot multi-stage: missing product image URL on ${missing
        .map((m) => m.product.name)
        .join(', ')}`,
    );
  }

  // 1. Load the room photo.
  const photoBuf = await downloadRoom(admin, roomPhotoKey);
  const { width, height } = await readDims(photoBuf);

  // 2. Cutout every product in parallel — these are the slow calls
  //    (~3s each via birefnet). Parallel matters when N >= 2.
  //
  // allSettled (#166) so one broken cutout (404, birefnet timeout,
  // malformed image bytes) doesn't take down the entire batch. We
  // log each failure with the product name + reason, then filter to
  // the survivors. A successful auto-stage of 3 / 4 items is better
  // than failing the whole render's auto-stage because one product
  // had a flaky image URL.
  const cutoutResults = await Promise.allSettled(
    items.map(async (it) => ({
      productName: it.product.name,
      productId: it.productId,
      bbox: toPixelBbox(it.bbox, width, height),
      productCutoutBuf: await cutoutProduct(it.product.imageUrl as string),
    })),
  );
  const cutouts: Array<{ bbox: PixelBbox; productCutoutBuf: Buffer }> = [];
  cutoutResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      cutouts.push({ bbox: r.value.bbox, productCutoutBuf: r.value.productCutoutBuf });
    } else {
      const it = items[i];
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(
        `[staging] cutout failed for "${it?.product?.name ?? 'item'}" (id=${it?.productId ?? '?'}): ${reason}`,
      );
    }
  });
  if (cutouts.length === 0) {
    throw new Error(
      `All ${items.length} cutouts failed — see [staging] warnings above for per-item reasons.`,
    );
  }

  // 3. Order by bbox area DESC so larger pieces composite first and
  //    smaller decor sits on top — without this a small cushion gets
  //    hidden behind the sofa it should be sitting on.
  cutouts.sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h);

  // 4. Single composite pass — one webp encode for all N products.
  const rawComposite = await compositeMultipleProducts({
    roomBuf: photoBuf,
    items: cutouts,
  });

  // 5. Harmonise the whole composite in one pass. Multi-stage saves
  //    one fal call here (vs one harmonise per product) and lets Flux
  //    integrate all the items into the scene together rather than
  //    separately.
  const compositeBuf = await harmoniseComposite(rawComposite);

  // 6. Persist + insert staged_images row.
  const label = buildStagingLabel(items.map((it) => it.product));
  const { imageUrl, storageKey, stagedImageId } = await persistComposite({
    admin,
    composite: compositeBuf,
    userId,
    renderId,
    projectId,
    productId: items[0]?.productId ?? null,
    productIds: items.map((it) => it.productId),
    itemIndex: 0,
    label,
  });

  return { imageUrl, prompt: label, stagedImageId, storageKey };
}

// --- helpers --------------------------------------------------------

async function downloadRoom(admin: SupabaseClient, key: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from('rooms').download(key);
  if (error || !data) {
    throw new Error(`Could not load room photo: ${error?.message ?? 'unknown'}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function readDims(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('Could not read room photo dimensions');
  return { width, height };
}

function toPixelBbox(
  bbox: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): PixelBbox {
  return {
    x: Math.round(bbox.x * width),
    y: Math.round(bbox.y * height),
    w: Math.round(bbox.w * width),
    h: Math.round(bbox.h * height),
  };
}

// Short human-readable label that becomes both the revision strip
// label and the staged_images.prompt column for record-keeping.
function buildStagingLabel(products: Array<{ name: string }>): string {
  if (products.length === 0) return 'Staged';
  const first = products[0];
  if (products.length === 1 && first) {
    return `+ ${cleanName(first.name)}`;
  }
  return `+ ${products.length} products: ${products
    .map((p) => cleanName(p.name))
    .slice(0, 3)
    .join(', ')}${products.length > 3 ? ', …' : ''}`;
}

function cleanName(name: string): string {
  // Drop the retailer variant suffix that gets appended on most SKUs,
  // e.g. 'Westwood Bench - Tobacco Ash' → 'Westwood Bench'.
  return name.replace(/\s*[-–]\s*[^-–]+$/, '').trim();
}

async function persistComposite({
  admin,
  composite,
  userId,
  renderId,
  projectId,
  productId,
  productIds,
  itemIndex,
  label,
}: {
  admin: SupabaseClient;
  composite: Buffer;
  userId: string;
  renderId: string;
  projectId: string | null;
  productId: string | null;
  productIds: string[];
  itemIndex: number;
  label: string;
}): Promise<{
  imageUrl: string;
  storageKey: string | null;
  stagedImageId: string | null;
}> {
  const stagingId = crypto.randomUUID();
  const outKey = `${userId}/staging/${stagingId}.webp`;
  const upload = await admin.storage.from('renders').upload(outKey, composite, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: true,
  });
  if (upload.error) {
    throw new Error(`Composite upload failed: ${upload.error.message}`);
  }

  const insertRes = await admin
    .from('staged_images')
    .insert({
      user_id: userId,
      project_id: projectId,
      render_id: renderId,
      product_id: productId,
      product_ids: productIds,
      item_index: itemIndex,
      image_storage_key: outKey,
      prompt: label,
    })
    .select('id')
    .single();
  const stagedImageId = (insertRes.data as { id: string } | null)?.id ?? null;

  const signed = await admin.storage.from('renders').createSignedUrl(outKey, 60 * 60 * 24);
  return {
    imageUrl: signed.data?.signedUrl ?? '',
    storageKey: outKey,
    stagedImageId,
  };
}
