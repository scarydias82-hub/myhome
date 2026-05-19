// Product cutout + room compositing. Replaces the old prompt-based
// staging that called Flux Pro Fill with a text description and got
// back generated furniture (not the actual SKU). Now we:
//
//   1. Background-remove the product image via fal birefnet
//   2. Resize the cutout to fit the picking-list bbox
//   3. Composite the actual pixels onto the user's room photo with
//      a soft drop shadow so the product looks grounded
//
// The user sees the SKU they picked. Trade-off vs the old approach:
// shadows are synthesised by sharp rather than inherited from Flux's
// understanding of the room's light source — slight "placed" look.
// Worth it: SKU fidelity is the table-stakes complaint.

import sharp from 'sharp';
import { getFal } from '@/lib/fal';

const REMBG_ENDPOINT = 'fal-ai/birefnet/v2';

export interface PixelBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Background-remove a product image via fal. Returns a PNG buffer with
// alpha channel so we can composite cleanly.
export async function cutoutProduct(imageUrl: string): Promise<Buffer> {
  const fal = getFal();
  const result = await fal.subscribe(REMBG_ENDPOINT, {
    input: { image_url: imageUrl },
    logs: false,
  });
  const data = result.data as { image?: { url?: string } };
  const cutoutUrl = data.image?.url;
  if (!cutoutUrl) throw new Error('birefnet returned no cutout image');
  const res = await fetch(cutoutUrl);
  if (!res.ok) throw new Error(`fetch cutout failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Composite one product cutout onto a room photo at a pixel-space
// bbox. Returns the composite as a webp buffer.
export async function compositeProductIntoRoom({
  roomBuf,
  productCutoutBuf,
  bbox,
}: {
  roomBuf: Buffer;
  productCutoutBuf: Buffer;
  bbox: PixelBbox;
}): Promise<Buffer> {
  const layers = await buildProductLayers(productCutoutBuf, bbox);
  return sharp(roomBuf).composite(layers).webp({ quality: 88 }).toBuffer();
}

// Multi-product composite. Lays each cutout onto the room in z-order
// (later items render on top — caller orders by depth if needed).
// One sharp composite call, one webp encode. Cheap relative to the N
// rembg calls that precede it (which can run in parallel).
export async function compositeMultipleProducts({
  roomBuf,
  items,
}: {
  roomBuf: Buffer;
  items: Array<{ productCutoutBuf: Buffer; bbox: PixelBbox }>;
}): Promise<Buffer> {
  if (items.length === 0) throw new Error('compositeMultipleProducts: no items');
  const layers: sharp.OverlayOptions[] = [];
  for (const item of items) {
    const itemLayers = await buildProductLayers(item.productCutoutBuf, item.bbox);
    layers.push(...itemLayers);
  }
  return sharp(roomBuf).composite(layers).webp({ quality: 88 }).toBuffer();
}

// Build the [shadow, cutout] layer pair for a single product. The
// shadow is a soft blurred copy of the alpha channel, offset down + a
// bit right and tinted near-black at low opacity. Without it the
// composite reads as a Photoshop job.
async function buildProductLayers(
  cutoutBuf: Buffer,
  bbox: PixelBbox,
): Promise<sharp.OverlayOptions[]> {
  const cutoutMeta = await sharp(cutoutBuf).metadata();
  const cw = cutoutMeta.width ?? bbox.w;
  const ch = cutoutMeta.height ?? bbox.h;
  const cutoutAspect = cw / ch;
  const bboxAspect = bbox.w / bbox.h;

  // Fit the cutout INSIDE the bbox while preserving its own aspect.
  let drawW: number;
  let drawH: number;
  if (cutoutAspect > bboxAspect) {
    drawW = bbox.w;
    drawH = Math.max(1, Math.round(bbox.w / cutoutAspect));
  } else {
    drawH = bbox.h;
    drawW = Math.max(1, Math.round(bbox.h * cutoutAspect));
  }

  // Resize the cutout. Keep alpha. PNG output preserves transparency
  // through sharp's composite pipeline.
  const resized = await sharp(cutoutBuf)
    .resize(drawW, drawH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  // Centre the cutout horizontally inside the bbox, anchor to the
  // bottom edge of the bbox so the product looks like it's sitting on
  // the floor / surface rather than floating.
  const drawX = bbox.x + Math.round((bbox.w - drawW) / 2);
  const drawY = bbox.y + (bbox.h - drawH);

  // Build the drop shadow: take the alpha channel, blur it, tint to
  // near-black, drop the opacity. The shadow sits a few pixels below
  // and slightly right of the cutout to suggest a light source from
  // upper-left (the AU coastal cliché — and what most room photos
  // happen to share when taken near a window).
  const shadowRadius = Math.max(6, Math.round(Math.min(drawW, drawH) * 0.04));
  const shadowOffsetX = Math.round(shadowRadius * 0.4);
  const shadowOffsetY = Math.round(shadowRadius * 0.7);

  const alpha = await sharp(resized).extractChannel('alpha').toBuffer();
  // Build a solid near-black layer the same size as the cutout, then
  // join the blurred alpha as its alpha channel → that's the shadow.
  const shadowBase = await sharp({
    create: {
      width: drawW,
      height: drawH,
      channels: 3,
      background: { r: 12, g: 10, b: 8 }, // editorial ink-ish
    },
  })
    .png()
    .toBuffer();
  const blurredAlpha = await sharp(alpha).blur(shadowRadius).toBuffer();
  const shadowBuf = await sharp(shadowBase)
    .joinChannel(blurredAlpha)
    .png()
    .ensureAlpha()
    .modulate({ brightness: 0.5 })
    .toBuffer();

  return [
    {
      input: shadowBuf,
      left: Math.max(0, drawX + shadowOffsetX),
      top: Math.max(0, drawY + shadowOffsetY),
      blend: 'multiply',
    },
    {
      input: resized,
      left: Math.max(0, drawX),
      top: Math.max(0, drawY),
    },
  ];
}
