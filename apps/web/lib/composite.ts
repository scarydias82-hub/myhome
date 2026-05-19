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
const HARMONIZE_ENDPOINT = 'fal-ai/flux/dev/image-to-image';

// Low-strength Flux img2img pass that takes a pasted composite and
// blends the edges, casts shadows that match the room's light
// direction, harmonises colour temperature. Strength 0.18 is the sweet
// spot: high enough to integrate the product into the scene, low
// enough to preserve the SKU's identity (colour, silhouette, material).
//
// Skips silently if FAL_KEY isn't set or the call errors — the
// un-harmonised composite is still a valid result, just more "placed".
export async function harmoniseComposite(compositeBuf: Buffer): Promise<Buffer> {
  try {
    const fal = getFal();
    // Upload the composite to a data URL so fal can fetch it.
    const dataUrl = `data:image/webp;base64,${compositeBuf.toString('base64')}`;
    const result = await fal.subscribe(HARMONIZE_ENDPOINT, {
      input: {
        prompt:
          'photorealistic interior photography, natural lighting integration, soft realistic shadows, coherent colour temperature, seamless composition, editorial magazine quality',
        image_url: dataUrl,
        strength: 0.18,
        num_inference_steps: 18,
        guidance_scale: 3.0,
        num_images: 1,
        enable_safety_checker: true,
      } as never,
      logs: false,
    });
    const data = result.data as { images?: Array<{ url: string }> };
    const url = data.images?.[0]?.url;
    if (!url) return compositeBuf;
    const fetched = await fetch(url);
    if (!fetched.ok) return compositeBuf;
    return Buffer.from(await fetched.arrayBuffer());
  } catch (err) {
    console.warn('[composite] harmonise pass failed, using raw composite', err);
    return compositeBuf;
  }
}

export interface PixelBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Background-remove a product image via fal. Returns a PNG buffer with
// alpha channel so we can composite cleanly. Upgrades known CDN URLs
// to high resolution before sending to birefnet — without this, Shopify
// URLs like `_600x.jpg` come through at thumbnail resolution and the
// cutout looks blurry when scaled to fit the room-photo bbox.
export async function cutoutProduct(imageUrl: string): Promise<Buffer> {
  const fal = getFal();
  const upgradedUrl = upgradeImageUrl(imageUrl);
  const result = await fal.subscribe(REMBG_ENDPOINT, {
    input: { image_url: upgradedUrl },
    logs: false,
  });
  const data = result.data as { image?: { url?: string } };
  const cutoutUrl = data.image?.url;
  if (!cutoutUrl) throw new Error('birefnet returned no cutout image');
  const res = await fetch(cutoutUrl);
  if (!res.ok) throw new Error(`fetch cutout failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Upgrade common product-image CDN URLs to the highest available
// resolution. Shopify in particular returns low-res variants by default
// (e.g. `_600x.jpg`) which makes the resulting cutout look blurry when
// composited into a high-res room photo. Strip the size suffix to get
// the original / master variant.
function upgradeImageUrl(url: string): string {
  // Shopify CDN — strip any embedded size suffix so the URL resolves to
  // the master image. Patterns observed: _600x.jpg, _600x600.jpg,
  // _small.jpg, _large.jpg, _grande.jpg, _master.jpg, _2048x2048.jpg, etc.
  if (/cdn\/shop\/|cdn\.shopify\.com|\.myshopify\.com/i.test(url)) {
    return url.replace(
      /_(\d+x\d*|small|compact|medium|large|grande|master|thumb|icon|pico|original)(?=\.(?:jpe?g|png|webp|gif)(?:\?|$))/gi,
      '',
    );
  }
  // Contentful (Dulux) — strip any existing dimension/format params and
  // request a known-good high-res JPG. The default `fm=webp&h=600` we
  // saw in earlier scrapes was painful for compositing.
  if (/images\.ctfassets\.net/i.test(url)) {
    const stripped = url.replace(/[?&](w|h|fit|fm|q)=[^&]*/gi, '').replace(/[?&]$/, '');
    const sep = stripped.includes('?') ? '&' : '?';
    return `${stripped}${sep}w=1500&fm=jpg&q=85`;
  }
  // Freedom — strip Coveo's base64-encoded transform context to fall
  // back to the raw media URL. Often higher-res than the transformed one.
  if (/api-prod\.freedom\.com\.au\/medias/i.test(url)) {
    return url.split('?')[0] ?? url;
  }
  // WordPress (Woodcut + others) — drop -NNNxNNN size suffix to land
  // on the original upload.
  if (/wp-content\/uploads/i.test(url)) {
    return url.replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp|gif)(?:\?|$))/i, '');
  }
  return url;
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
  // through sharp's composite pipeline. Apply a slight blur to the
  // alpha channel (feathered edges) so the silhouette doesn't read as
  // hard-cropped — a few pixels of softness reads as anti-aliasing.
  const featherRadius = Math.max(1, Math.round(Math.min(drawW, drawH) * 0.003));
  const resized = await sharp(cutoutBuf)
    .resize(drawW, drawH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const featheredAlpha = await sharp(resized)
    .extractChannel('alpha')
    .blur(featherRadius)
    .toBuffer();
  const featheredResized = await sharp(resized)
    .removeAlpha()
    .joinChannel(featheredAlpha)
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

  const alpha = await sharp(featheredResized).extractChannel('alpha').toBuffer();
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
      input: featheredResized,
      left: Math.max(0, drawX),
      top: Math.max(0, drawY),
    },
  ];
}
