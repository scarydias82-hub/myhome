// gpt-image-1 (OpenAI) render path (#176).
//
// Pivot from Flux Kontext multi-image after PR #173 produced collage
// outputs — Kontext stitched the product reference images into the
// frame as side panels rather than using them as visual conditioning
// for a single rendered scene. gpt-image-1 supports multi-image edit
// natively for visual reference (the model "sees" each image and
// reasons about how to incorporate them into a unified output), which
// is what ChatGPT Casa's interior design surface uses.
//
// Architecture differs from the fal Kontext path:
//   - SYNCHRONOUS: openai.images.edit returns the rendered bytes
//     directly (~15-30s). No queue, no polling required.
//   - No fal_request_id involved. The /api/render flow runs the
//     openai call inside the existing after() worker, persists the
//     result to Supabase storage, then flips renders.status to
//     'succeeded' with output_url set. The status route's polling
//     model still works because the picking-list + auto-stage flow
//     is unchanged after the rendered image lands.
//
// Cost: ~$0.04 per 1024x1024 (medium quality) — sits between fal
// Kontext ($0.04) and Kontext HD. Use 'medium' default to keep
// per-render economics comparable.
//
// The function never throws on transient OpenAI errors — caller is
// expected to log and surface failures (status route updates render
// row to status='failed' with the error message).

import { getServerEnv } from './env';

const OPENAI_IMAGES_EDITS = 'https://api.openai.com/v1/images/edits';

export interface OpenAIImageInput {
  prompt: string;
  /** Room photo bytes (image 1 — the structure-source / base). */
  roomBuf: Buffer;
  /** Optional palette swatch (image 2). Skip if you don't have one. */
  paletteSwatchBuf?: Buffer | null;
  /** Optional product reference images (images 3+). Cap at 4 caller-side
   *  to keep payload + token cost manageable; gpt-image-1 accepts up
   *  to 16 but quality degrades past 5-6. */
  productImageBufs?: Buffer[];
  /** Output size. 1024x1024 default; landscape / portrait options also
   *  supported by the model. */
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  /** Quality tier — 'low' / 'medium' / 'high'. Default medium. */
  quality?: 'low' | 'medium' | 'high';
}

export interface OpenAIImageResult {
  /** PNG bytes of the generated image (gpt-image-1 outputs PNG). */
  imageBuf: Buffer;
  /** Roundtrip time in ms (for logging / cost-perf tuning). */
  durationMs: number;
}

export async function submitOpenAIImageRender(
  input: OpenAIImageInput,
): Promise<OpenAIImageResult> {
  const { OPENAI_API_KEY } = getServerEnv();
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set — cannot run gpt-image-1 render');
  }

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', input.prompt);
  form.append('n', '1');
  form.append('size', input.size ?? '1024x1024');
  form.append('quality', input.quality ?? 'medium');

  // image[] is the multi-input field. Order matters: the prompt
  // references images by index, so we keep the same convention as
  // the Flux Kontext path — [room, palette, ...products].
  form.append(
    'image[]',
    new Blob([new Uint8Array(input.roomBuf)], { type: 'image/png' }),
    'room.png',
  );
  if (input.paletteSwatchBuf) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(input.paletteSwatchBuf)], { type: 'image/png' }),
      'palette.png',
    );
  }
  const productBufs = (input.productImageBufs ?? []).slice(0, 4);
  for (let i = 0; i < productBufs.length; i++) {
    const buf = productBufs[i];
    if (!buf) continue;
    form.append(
      'image[]',
      new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }),
      `product-${i}.jpg`,
    );
  }

  const t0 = Date.now();
  const res = await fetch(OPENAI_IMAGES_EDITS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
    // gpt-image-1 typically 15-30s. Hard cap at 55s so we never blow
    // Vercel's function maxDuration (60s for /api/render).
    signal: AbortSignal.timeout(55_000),
  });
  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `openai images.edit ${res.status} after ${durationMs}ms: ${errText.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    const errMsg = json.error?.message ?? 'no image data in response';
    throw new Error(`openai images.edit returned no image (${durationMs}ms): ${errMsg}`);
  }

  const imageBuf = Buffer.from(b64, 'base64');
  console.log(
    `[openai-image] rendered ${imageBuf.length} bytes in ${durationMs}ms ` +
      `(refs: room + ${input.paletteSwatchBuf ? 'palette' : 'no-palette'} + ${productBufs.length} products)`,
  );
  return { imageBuf, durationMs };
}

/** Build a natural-language prompt for gpt-image-1. Less verbose than
 *  the Flux Kontext prompt — gpt-image-1 follows clear instruction
 *  better with concise prose than with bullet-point directive lists. */
export function buildOpenAIImagePrompt({
  paletteName,
  paletteVibe,
  styleName,
  roomType,
  productRefs,
}: {
  paletteName: string;
  paletteVibe?: string | null;
  styleName: string;
  roomType?: string | null;
  productRefs?: Array<{ name: string; category: string; retailer: string }>;
}): string {
  const lines: string[] = [];
  lines.push(
    `Restyle the room in image 1 in the ${paletteName} palette (image 2)${
      paletteVibe ? ` — ${paletteVibe}` : ''
    }. The output should be a single photoreal interior render of the same room with a complete makeover in the ${styleName} aesthetic.`,
  );

  if (productRefs && productRefs.length > 0) {
    lines.push('');
    lines.push(
      `Feature these specific pieces — match the silhouette, material, and finish from each reference image:`,
    );
    productRefs.slice(0, 4).forEach((p, i) => {
      const imgIdx = 3 + i;
      lines.push(
        `- Image ${imgIdx}: a ${p.category.toLowerCase()} (${p.name} from ${p.retailer}). Place it naturally in the scene at a position appropriate for a ${p.category.toLowerCase()}.`,
      );
    });
  }

  lines.push('');
  lines.push(
    `Critical: preserve the room's architecture exactly — same walls, windows, doors, ceiling, camera angle, dimensions. Do not invent new windows, walls, or openings. Only the decor, furniture, soft furnishings, and finishes change. The result should look like the same physical room professionally restyled.`,
  );

  if (roomType) {
    lines.push(
      `Room type context: ${roomType.replace(/_/g, ' ')}. Use furniture and styling appropriate for this room.`,
    );
  }

  return lines.join('\n');
}
