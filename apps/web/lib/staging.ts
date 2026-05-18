// Virtual staging: composite a specific catalogue product into the user's
// actual room photo by inpainting the existing item's region.
//
// Pipeline:
//   1. Caller provides the picking-list bbox (the region in the rendered
//      image where the matched item sits). Because our render pipeline
//      preserves architecture (img2img + canny), the same bbox in % space
//      lines up with the equivalent region in the ORIGINAL room photo.
//   2. We render a binary mask PNG from the bbox at the original photo's
//      resolution and upload it to Storage briefly so fal can fetch it.
//   3. We call fal-ai/flux-pro/v1/fill with the room photo + mask + a
//      prompt assembled from the product metadata.
//   4. Fetch the result and either return its URL or re-upload to Storage
//      for permanence.

import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFal } from '@/lib/fal';

const INPAINT_ENDPOINT = 'fal-ai/flux-pro/v1/fill';

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
}

export interface StagingInput {
  admin: SupabaseClient;
  roomPhotoKey: string; // storage key for the original room photo
  bbox: { x: number; y: number; w: number; h: number }; // percentages 0..1
  product: StagingProduct;
  userId: string;
}

export async function stageProduct({
  admin,
  roomPhotoKey,
  bbox,
  product,
  userId,
}: StagingInput): Promise<StagingResult> {
  // 1. Get the room photo bytes + dimensions.
  const { data: download, error: downloadError } = await admin.storage
    .from('rooms')
    .download(roomPhotoKey);
  if (downloadError || !download) {
    throw new Error(`Could not load room photo: ${downloadError?.message ?? 'unknown'}`);
  }
  const photoBuf = Buffer.from(await download.arrayBuffer());
  const metadata = await sharp(photoBuf).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error('Could not read room photo dimensions');

  // 2. Build a binary mask PNG. Black = keep, white = inpaint.
  const maskBuf = await buildMask({
    width,
    height,
    bbox: {
      x: Math.round(bbox.x * width),
      y: Math.round(bbox.y * height),
      w: Math.round(bbox.w * width),
      h: Math.round(bbox.h * height),
    },
  });

  // 3. Upload room photo + mask to storage with short signed URLs that fal
  //    can fetch. We re-use the rooms bucket for the mask under a temp prefix.
  const stagingId = crypto.randomUUID();
  const maskKey = `${userId}/staging/${stagingId}-mask.png`;
  const maskUp = await admin.storage.from('rooms').upload(maskKey, maskBuf, {
    contentType: 'image/png',
    upsert: true,
  });
  if (maskUp.error) throw new Error(`Mask upload failed: ${maskUp.error.message}`);

  const [photoSigned, maskSigned] = await Promise.all([
    admin.storage.from('rooms').createSignedUrl(roomPhotoKey, 60 * 10),
    admin.storage.from('rooms').createSignedUrl(maskKey, 60 * 10),
  ]);
  if (!photoSigned.data?.signedUrl || !maskSigned.data?.signedUrl) {
    throw new Error('Could not sign storage URLs for staging');
  }

  // 4. Build the prompt from product metadata.
  const prompt = buildStagingPrompt(product);

  // 5. Call fal inpaint.
  const fal = getFal();
  // fal-ai/flux-pro/v1/fill schema: image_url + mask_url + prompt are required.
  // guidance_scale: Flux Pro wants 1.5-5 (we had 30, which 422s).
  // safety_tolerance: 1-6, replaces the legacy enable_safety_checker flag.
  // No num_inference_steps on the Pro endpoint — it picks internally.
  const result = await fal.subscribe(INPAINT_ENDPOINT, {
    input: {
      image_url: photoSigned.data.signedUrl,
      mask_url: maskSigned.data.signedUrl,
      prompt,
      guidance_scale: 3.5,
      num_images: 1,
      safety_tolerance: '2',
      output_format: 'jpeg',
    } as never,
    logs: false,
  });
  const data = result.data as { images?: Array<{ url: string }> };
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal returned no staging image');

  // 6. Persist the composite back to storage for permanence.
  const compositeBytes = new Uint8Array(await (await fetch(imageUrl)).arrayBuffer());
  const outKey = `${userId}/staging/${stagingId}.webp`;
  const compUp = await admin.storage.from('renders').upload(outKey, compositeBytes, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: true,
  });
  if (compUp.error) {
    // Non-fatal — return the fal URL anyway (expires after a few days).
    return { imageUrl, prompt };
  }
  const signed = await admin.storage.from('renders').createSignedUrl(outKey, 60 * 60 * 24);
  return { imageUrl: signed.data?.signedUrl ?? imageUrl, prompt };
}

async function buildMask({
  width,
  height,
  bbox,
}: {
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
}): Promise<Buffer> {
  // Slightly pad the bbox so the inpaint can blend cleanly with surrounding
  // pixels — strict bboxes from object detection often clip the silhouette.
  const pad = 0.08;
  const padX = Math.round(bbox.w * pad);
  const padY = Math.round(bbox.h * pad);
  const x = Math.max(0, bbox.x - padX);
  const y = Math.max(0, bbox.y - padY);
  const w = Math.min(width - x, bbox.w + padX * 2);
  const h = Math.min(height - y, bbox.h + padY * 2);

  // Start from a black image; composite a white rectangle in.
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: Math.max(1, w),
            height: Math.max(1, h),
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        })
          .png()
          .toBuffer(),
        left: x,
        top: y,
      },
    ])
    .png()
    .toBuffer();
}

function buildStagingPrompt(p: StagingProduct): string {
  const tokens: string[] = [];
  tokens.push(`a ${cleanProductName(p.name)}`);
  if (p.materials && p.materials.length > 0) tokens.push(`in ${p.materials.slice(0, 3).join(', ')}`);
  if (p.colors && p.colors.length > 0) tokens.push(`${p.colors.slice(0, 2).join(' and ')} tones`);
  tokens.push('photorealistic interior photography');
  tokens.push('natural daylight, soft shadows');
  tokens.push('matched perspective and scale with the surrounding room');
  return tokens.join(', ');
}

function cleanProductName(name: string): string {
  // Strip the colour/variant suffix that retailers tack on, e.g.
  // "Westwood Bench - Tobacco Ash" → "Westwood Bench".
  return name.replace(/\s*[-–]\s*[^-–]+$/, '').toLowerCase().trim();
}
