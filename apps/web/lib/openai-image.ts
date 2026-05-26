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
  /** Mode A starter: the user's room photo (preserved-architecture
   *  base). Optional because Mode B (A4, 2026-05-26) uses
   *  styleRefBufs as the starter image set instead — it generates a
   *  new room rather than restyling an existing one. At least one
   *  of roomBuf or styleRefBufs must be non-empty; gpt-image-1's
   *  images.edit endpoint requires ≥1 input image. */
  roomBuf?: Buffer | null;
  /** Mode B style anchor: Coco lifestyle imagery from design_knowledge
   *  (PR #47/49). Prepended to the image[] sequence (images 1..N)
   *  so gpt-image-1 reads them as the aesthetic ground truth before
   *  any product references. Empty array in Mode A. */
  styleRefBufs?: Buffer[];
  /** Optional palette swatch (image after styleRefs / roomBuf). */
  paletteSwatchBuf?: Buffer | null;
  /** Optional product reference images (always last). Cap at 10
   *  caller-side to allow multi-angle references (4 products × 2-3
   *  angles each); gpt-image-1 accepts up to 16 but quality
   *  degrades past 8-10. */
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
  // references images by index. Two layouts depending on mode:
  //   - Mode A:  [room, palette?, ...products]
  //   - Mode B:  [...styleRefs, palette?, ...products]
  // The starter images (style refs in Mode B, room in Mode A) come
  // first so gpt-image-1 reads them as the visual anchor before any
  // product directives.
  const styleRefBufs = input.styleRefBufs ?? [];
  for (let i = 0; i < styleRefBufs.length; i++) {
    const buf = styleRefBufs[i];
    if (!buf) continue;
    form.append(
      'image[]',
      new Blob([new Uint8Array(buf)], { type: 'image/png' }),
      `style-${i}.png`,
    );
  }
  if (input.roomBuf) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(input.roomBuf)], { type: 'image/png' }),
      'room.png',
    );
  }
  // Defensive: gpt-image-1 rejects zero-image submissions. If both
  // roomBuf and styleRefBufs are empty there's nothing to send — the
  // caller violated the contract.
  if (styleRefBufs.length === 0 && !input.roomBuf) {
    throw new Error(
      'submitOpenAIImageRender: at least one of roomBuf or styleRefBufs must be provided',
    );
  }
  if (input.paletteSwatchBuf) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(input.paletteSwatchBuf)], { type: 'image/png' }),
      'palette.png',
    );
  }
  // Cap bumped from 4 to 10 with the multi-angle render path (#36
  // multi-image + this PR). The caller decides the actual product
  // count × angle count product; this cap is the safety upper bound
  // before gpt-image-1's 16-image hard limit (room + palette = 2
  // implicit, leaves 14 free slots).
  const productBufs = (input.productImageBufs ?? []).slice(0, 10);
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
// Categories where the room composition typically calls for multiple
// matching instances of the same product (the picker enforces 1 pick
// per category — the renderer multiplies it). Lowercase to match the
// `.toLowerCase()` of the incoming category strings; includes both
// the singular form (from Coco-style scrapers post-#36) and the
// plural form (Freedom/Fantastic/etc.) so any retailer's product
// triggers the multi-instance prompt directive.
const MULTI_INSTANCE_CATEGORIES = new Set([
  'dining chair',
  'dining chairs',
  'bedside table',
  'bedside tables',
  'lounge chair',
  'lounge chairs',
  'armchair',
  'armchairs',
  'stool',
  'stools',
]);

// Floor coverings — categories that lie on the floor rather than
// stand vertically as furniture. Triggers the rug-specific prompt
// directive (R1, 2026-05-26): rugs need explicit "replace existing"
// or "add new" semantics rather than the generic "place this piece"
// instruction. Mirror of FLOOR_COVERING_CATEGORIES in lib/curation.ts
// — keep these in sync when adding a category.
const FLOOR_COVERING_CATEGORIES = new Set([
  'rug',
  'rugs',
  'carpet',
  'carpets',
  'flooring',
]);

// Whether the source room photo shows an existing rug already on the
// floor. Drives the rug directive's verb choice (REPLACE vs ADD).
// Derived in the render route from `rooms.analysis.existing_furniture`
// (vision-extracted) — if any item matches /rug/i, we treat the room
// as having an existing rug. Mode B sends 'absent' (blank canvas).
export type RugRoomContext = 'present' | 'absent' | 'unknown';

// Category-specific size thresholds for the "compact / standard /
// oversized" descriptor in the render prompt. Each entry names the
// dominant dimension (`width_cm` for most furniture; `height_cm`
// for lamps + stools) and the thresholds in cm — below `compact`
// is compact, above `oversized` is oversized, in between is standard.
// Lowercase keys for the same case-insensitive match approach as
// MULTI_INSTANCE_CATEGORIES.
//
// Numbers chosen from the AU furniture market's typical sizing
// brackets — sofa width tracks seat count (2-seat ≈170, 3-seat
// ≈220, modular >250); bed width tracks bed size (single ≈90,
// queen ≈155, king ≈180); dining table tracks seat count.
type SizeDimKey = 'width_cm' | 'depth_cm' | 'height_cm';
const CATEGORY_SIZE_THRESHOLDS: Record<
  string,
  { dim: SizeDimKey; compact: number; oversized: number }
> = {
  'sofa': { dim: 'width_cm', compact: 180, oversized: 250 },
  'sofas': { dim: 'width_cm', compact: 180, oversized: 250 },
  'bed': { dim: 'width_cm', compact: 140, oversized: 180 },
  'beds': { dim: 'width_cm', compact: 140, oversized: 180 },
  'coffee table': { dim: 'width_cm', compact: 80, oversized: 150 },
  'coffee tables': { dim: 'width_cm', compact: 80, oversized: 150 },
  'dining table': { dim: 'width_cm', compact: 150, oversized: 220 },
  'dining tables': { dim: 'width_cm', compact: 150, oversized: 220 },
  'chair': { dim: 'width_cm', compact: 70, oversized: 100 },
  'chairs': { dim: 'width_cm', compact: 70, oversized: 100 },
  'lounge chair': { dim: 'width_cm', compact: 70, oversized: 100 },
  'lounge chairs': { dim: 'width_cm', compact: 70, oversized: 100 },
  'armchair': { dim: 'width_cm', compact: 70, oversized: 100 },
  'armchairs': { dim: 'width_cm', compact: 70, oversized: 100 },
  'dining chair': { dim: 'width_cm', compact: 45, oversized: 60 },
  'dining chairs': { dim: 'width_cm', compact: 45, oversized: 60 },
  'bedside table': { dim: 'width_cm', compact: 40, oversized: 60 },
  'bedside tables': { dim: 'width_cm', compact: 40, oversized: 60 },
  'side table': { dim: 'width_cm', compact: 40, oversized: 60 },
  'side tables': { dim: 'width_cm', compact: 40, oversized: 60 },
  'floor lamp': { dim: 'height_cm', compact: 140, oversized: 180 },
  'floor lamps': { dim: 'height_cm', compact: 140, oversized: 180 },
  'table lamp': { dim: 'height_cm', compact: 40, oversized: 60 },
  'table lamps': { dim: 'height_cm', compact: 40, oversized: 60 },
  'rug': { dim: 'width_cm', compact: 150, oversized: 280 },
  'rugs': { dim: 'width_cm', compact: 150, oversized: 280 },
  'stool': { dim: 'height_cm', compact: 65, oversized: 80 },
  'stools': { dim: 'height_cm', compact: 65, oversized: 80 },
};

// Returns "compact" / "standard" / "oversized" + the raw cm string
// for a category-aware prompt clause. Falls through cleanly when
// dimensions or category threshold are missing — returns null and
// the caller skips the size clause entirely.
function dimensionsClause(
  category: string,
  dimensions: { width_cm?: number | null; depth_cm?: number | null; height_cm?: number | null } | null | undefined,
): string | null {
  if (!dimensions) return null;
  const { width_cm: w, depth_cm: d, height_cm: h } = dimensions;
  // Need at least one dimension; "—" is used as a placeholder for the
  // ones that are missing so a partial dim doesn't read like 0×0×0cm.
  if (w == null && d == null && h == null) return null;
  const dimStr = `${w ?? '—'}×${d ?? '—'}×${h ?? '—'}cm`;
  const thresh = CATEGORY_SIZE_THRESHOLDS[category];
  if (!thresh) return dimStr; // unknown category — still pass raw cm
  const value = dimensions[thresh.dim];
  if (value == null) return dimStr; // dominant dim missing
  const descriptor = value <= thresh.compact ? 'compact' : value >= thresh.oversized ? 'oversized' : 'standard-sized';
  return `${descriptor} at ${dimStr}`;
}

// Compose the rug-specific directive when any picked product is a
// floor covering (R1, 2026-05-26). Generic per-product instruction
// ("place this piece at a position appropriate for a {category}")
// doesn't read right for rugs — they go on the floor, with explicit
// replace-or-add semantics relative to whatever was already there.
// Returns null when the picks don't include a rug; caller skips
// appending in that case.
function rugDirective(
  productRefs: ReadonlyArray<{ name: string; category: string }> | undefined,
  rugRoomContext: RugRoomContext,
): string | null {
  if (!productRefs || productRefs.length === 0) return null;
  const rugs = productRefs.filter((p) =>
    FLOOR_COVERING_CATEGORIES.has(p.category.toLowerCase()),
  );
  if (rugs.length === 0) return null;

  const rugNames = rugs.map((r) => r.name).join(', ');
  if (rugRoomContext === 'present') {
    return `Floor covering: the source room photo shows an existing rug on the floor. REPLACE that rug with the picked rug (${rugNames}). Match the picked rug's exact colour, pile texture, and pattern. The new rug sits in the same floor location and orientation as the original. Do not show two rugs.`;
  }
  if (rugRoomContext === 'absent') {
    return `Floor covering: the room has no existing rug. ADD the picked rug (${rugNames}) to the floor as a new piece, anchoring the main furniture grouping (sofa + coffee table, or under the dining table, or at the foot of the bed depending on room type). Render its exact colour, pile texture, and pattern from the reference image.`;
  }
  // 'unknown' fallback — vision didn't tell us either way. Let the
  // model decide based on the source photo but be explicit about
  // the rug's identity.
  return `Floor covering: place the picked rug (${rugNames}) on the floor. If the source photo already has a rug, REPLACE it with this one; if not, ADD this rug as a new piece. Either way, render its exact colour, pile texture, and pattern from the reference image.`;
}

export function buildOpenAIImagePrompt({
  paletteName,
  paletteVibe,
  styleName,
  roomType,
  productRefs,
  rugRoomContext = 'unknown',
}: {
  paletteName: string;
  paletteVibe?: string | null;
  styleName: string;
  roomType?: string | null;
  /** Product reference shape now includes the vision_profile-derived
   *  silhouette ("low-profile modern armchair with curved arms and
   *  round upholstered seat"). The prompt leads with this descriptor
   *  for each pick — gives gpt-image-1 concrete visual language to
   *  anchor to the reference image, rather than a generic category
   *  that lets the model's priors take over. */
  productRefs?: Array<{
    name: string;
    category: string;
    retailer: string;
    silhouette?: string | null;
    /** Scraped product dimensions (cm). When present, the per-product
     *  directive gets a size descriptor ("compact / standard / oversized
     *  at WxDxHcm") so gpt-image-1 doesn't default to its priors for
     *  what "a sofa" or "a queen bed" should be sized like. */
    dimensions?: {
      width_cm?: number | null;
      depth_cm?: number | null;
      height_cm?: number | null;
    } | null;
  }>;
  /** Whether the source room photo shows an existing rug. Drives
   *  the rug directive's verb choice (REPLACE vs ADD vs let-the-
   *  model-decide). Derived from `rooms.analysis.existing_furniture`
   *  in the render route. Default 'unknown' keeps the prompt
   *  intentionally hedging when vision didn't tell us. */
  rugRoomContext?: RugRoomContext;
}): string {
  const lines: string[] = [];
  lines.push(
    `Restyle the room in image 1 in the ${paletteName} palette (image 2)${
      paletteVibe ? ` — ${paletteVibe}` : ''
    }. The output should be a single photoreal interior render of the same room with a complete makeover in the ${styleName} aesthetic.`,
  );

  if (productRefs && productRefs.length > 0) {
    lines.push('');
    // Strong lead-in. The previous prompt said "match the silhouette,
    // material, and finish" — which is good but gpt-image-1 still
    // routinely substituted style-similar generics. Tightening with
    // explicit "MUST appear", "precisely", and "do NOT substitute"
    // language gives the model a stronger constraint to hold against
    // its room-composition priors.
    lines.push(
      `These products MUST appear in the rendered scene exactly as shown in the reference images that follow. Match each piece's silhouette, proportion, material, and finish precisely. Do NOT substitute a stylistically-similar generic — if the reference shows a wooden armchair with curved arms, render that exact armchair, not a generic dining chair or a different armchair style.`,
    );
    productRefs.slice(0, 4).forEach((p, i) => {
      const imgIdx = 3 + i;
      const cat = p.category.toLowerCase();
      // Lead each directive with the Haiku-derived silhouette when
      // available. "low-profile modern armchair with curved arms and
      // round upholstered seat" is much harder for gpt-image-1 to
      // misread than a bare category like "armchair". Falls back to
      // the category when vision_profile.silhouette is missing
      // (older / un-vision-profiled rows).
      const baseDescription = p.silhouette
        ? `${p.silhouette}`
        : `a ${cat}`;
      // Append dimensions clause when available — gives gpt-image-1
      // both a category-relative size cue ("oversized") and the raw
      // cm so it doesn't default to whatever the model thinks "a
      // queen bed" or "a 3-seat sofa" should look like at room scale.
      const dimClause = dimensionsClause(cat, p.dimensions);
      const description = dimClause
        ? `Image ${imgIdx}: ${baseDescription} (${p.name}, ${dimClause}, from ${p.retailer}).`
        : `Image ${imgIdx}: ${baseDescription} (${p.name}, from ${p.retailer}).`;
      // Multi-instance categories: room naturally takes multiple
      // matching pieces (dining chairs around a table, bedside tables
      // flanking a bed). Example dropped from the directive (#40 —
      // the previous "a set of 4-6 around a dining table" example
      // leaked into non-dining-chair picks, overriding the reference
      // image and producing dining-chair-shaped seating regardless
      // of what was picked). Let the room context + reference image
      // decide the configuration.
      const placement = MULTI_INSTANCE_CATEGORIES.has(cat)
        ? `Place this SAME exact piece multiple times in the configuration the room calls for, every instance matching the silhouette and material from this image. Never substitute with a different style of ${cat}.`
        : `Place this exact piece at a position appropriate for a ${cat}. Match the silhouette exactly from this image.`;
      lines.push(`- ${description} ${placement}`);
    });
  }

  lines.push('');
  lines.push(
    `Critical: preserve the room's architecture exactly — same walls, windows, doors, ceiling, camera angle, dimensions. Do not invent new windows, walls, or openings. Only the decor, furniture, soft furnishings, paint colour, and finishes change. The result should look like the same physical room professionally restyled.`,
  );

  if (roomType) {
    lines.push(
      `Room type context: ${roomType.replace(/_/g, ' ')}. Use styling appropriate for this room, but ALWAYS the specific pieces in the reference images above — never generic substitutes from the model's defaults.`,
    );
  }

  const rugLine = rugDirective(productRefs, rugRoomContext);
  if (rugLine) {
    lines.push('');
    lines.push(rugLine);
  }

  return lines.join('\n');
}

// Mode B prompt — blank-canvas Coco-only design flow (A4, 2026-05-26).
// Key difference from buildOpenAIImagePrompt above: this prompt does
// NOT instruct the model to preserve the user's room photo. Mode B
// generates a NEW room of the supplied dimensions, in the
// contemporary Coco Republic aesthetic shown by the lifestyle
// reference images, featuring the user's picked products.
//
// Image-ordering contract (caller is responsible — see /api/render):
//   - Images 1..N    : Coco lifestyle references from design_knowledge
//                      (the visual style anchor; replaces the user's
//                      room photo as the "starter")
//   - Image  N+1     : palette swatch (optional)
//   - Images N+2..M  : product references (the user's picks; same
//                      silhouette + dimension language as Mode A)
//
// The prompt enumerates these explicitly so gpt-image-1 knows which
// images are *style* references vs *product* commitments.
export function buildModeBPrompt({
  paletteName,
  paletteVibe,
  roomType,
  width_m,
  depth_m,
  cocoLifestyleCount,
  productRefs,
}: {
  paletteName: string;
  paletteVibe?: string | null;
  roomType?: string | null;
  /** Room dimensions vision extracted (m). Either or both may be null
   *  when vision couldn't infer them; the prompt omits the dimension
   *  clause when both are null. */
  width_m: number | null;
  depth_m: number | null;
  /** How many Coco lifestyle reference images the caller is sending
   *  as image[1..cocoLifestyleCount]. The prompt names this count
   *  so gpt-image-1 knows where style-references end and product-
   *  references begin. */
  cocoLifestyleCount: number;
  productRefs?: Array<{
    name: string;
    category: string;
    retailer: string;
    silhouette?: string | null;
    dimensions?: {
      width_cm?: number | null;
      depth_cm?: number | null;
      height_cm?: number | null;
    } | null;
  }>;
}): string {
  const lines: string[] = [];
  const roomLabel = roomType?.replace(/_/g, ' ') ?? 'room';

  lines.push(
    `Design a new ${roomLabel} from scratch. This is not a restyle of an existing space — generate the room itself: walls, floor, ceiling, natural light source, and all furnishings.`,
  );

  // Dimension clause when vision provided them. Image models don't
  // honour raw cm faithfully, but the proportional cue (long vs
  // square, generous vs compact) does land.
  if (width_m && depth_m) {
    const proportion =
      Math.max(width_m, depth_m) / Math.min(width_m, depth_m) > 1.4
        ? 'rectangular' : 'roughly square';
    lines.push(
      `Approximate dimensions: ${width_m.toFixed(1)} m × ${depth_m.toFixed(1)} m. ${proportion.charAt(0).toUpperCase() + proportion.slice(1)} layout. Render at a camera angle and focal length that shows the whole room comfortably, the way an architectural interior photographer would compose it.`,
    );
  } else {
    lines.push(
      `Render at a camera angle and focal length that shows the whole room comfortably, the way an architectural interior photographer would compose it.`,
    );
  }

  // Style anchor — palette + Coco lifestyle visual reference.
  lines.push('');
  lines.push(
    `Aesthetic: ${paletteName}${paletteVibe ? ` (${paletteVibe})` : ''}. Contemporary, restrained, editorial. The palette card is one of the reference images sent with this prompt; use those hex codes for the walls + soft furnishings.`,
  );

  if (cocoLifestyleCount > 0) {
    lines.push('');
    lines.push(
      `The FIRST ${cocoLifestyleCount} reference image(s) are contemporary Coco Republic interior photographs. Use these as the ground truth for material palette, lighting quality, soft natural daylight, considered restraint, and overall mood. Match how those interiors handle texture (linen, oak, plaster, sculptural form), how they compose negative space, and how they treat natural light. Do NOT copy specific furniture from those images — they are STYLE references, not product commitments.`,
    );
  }

  // Product anchors — same silhouette + dimension treatment as Mode A.
  if (productRefs && productRefs.length > 0) {
    lines.push('');
    const productOffset = cocoLifestyleCount + 1 + 1; // +1 for palette swatch
    lines.push(
      `These products MUST appear in the rendered scene exactly as shown in the reference images that follow (starting at image ${productOffset + 1}). Match each piece's silhouette, proportion, material, and finish precisely. Do NOT substitute a stylistically-similar generic.`,
    );
    productRefs.slice(0, 4).forEach((p, i) => {
      const imgIdx = productOffset + 1 + i;
      const cat = p.category.toLowerCase();
      const baseDescription = p.silhouette ?? `a ${cat}`;
      const dimClause = p.dimensions ? dimensionsClause(cat, p.dimensions) : null;
      const description = dimClause
        ? `Image ${imgIdx}: ${baseDescription} (${p.name}, ${dimClause}, from ${p.retailer}).`
        : `Image ${imgIdx}: ${baseDescription} (${p.name}, from ${p.retailer}).`;
      const placement = MULTI_INSTANCE_CATEGORIES.has(cat)
        ? `Place this SAME exact piece multiple times in the configuration the room calls for, every instance matching the silhouette and material from this image. Never substitute with a different style of ${cat}.`
        : `Place this exact piece at a position appropriate for a ${cat}. Match the silhouette exactly from this image.`;
      lines.push(`- ${description} ${placement}`);
    });
  }

  // Final mode-specific framing.
  // Mode B is blank-canvas — by definition there's no existing rug
  // to replace. Any picked rug is always 'absent' context (a new
  // addition to the room being designed).
  const rugLine = rugDirective(productRefs, 'absent');
  if (rugLine) {
    lines.push('');
    lines.push(rugLine);
  }

  lines.push('');
  lines.push(
    `Output: photorealistic interior photography, magazine-editorial quality, soft natural daylight, considered minimalism. Do not include people, pets, or decorative styling (no draped throws, no laundry, no clutter). The user is going to see their picked products composed into this new room.`,
  );

  return lines.join('\n');
}
