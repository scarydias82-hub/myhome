// Image pre-processing helpers shared between the eval pipeline and
// the production /api/render route.
//
// The headline helper is `trimBlackBorders` — phone screenshots
// commonly have letterbox bars (e.g. 2532×1170 from an iPhone Pro
// Max screen) that confuse the render pipeline catastrophically:
//   * canny ControlNet treats the black-to-photo boundary as a hard
//     edge and tries to preserve it through the render — Flux paints
//     "wall" up to the boundary, leaving the original black bars
//   * computeFluxDimensions reads the full file aspect ratio
//     (including bars) and tells Flux to render at e.g. 2.16:1 when
//     the actual photo content is 4:3 — the room gets squashed
//   * Claude vision evaluator scores the whole rendered image
//     including the bars, dragging every criterion down
//
// trimBlackBorders detects + removes uniform black (or near-black)
// borders before the buffer flows downstream.

import sharp from 'sharp';

export interface TrimResult {
  buf: Buffer;
  trimmed: boolean;
  // For logging — before/after dimensions when a trim happened.
  before?: { width: number; height: number };
  after?: { width: number; height: number };
}

// Trim uniform dark borders. sharp.trim() auto-detects the corner
// colour and trims pixels matching it within `threshold`. threshold
// of 20 catches anything within 20/255 of the corner — handles
// slight JPEG compression noise around hard black boundaries.
// If no trim is needed or trim isn't possible, returns the input
// unchanged with trimmed=false.
export async function trimBlackBorders(buf: Buffer): Promise<TrimResult> {
  let before: { width: number; height: number } | undefined;
  try {
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) before = { width: meta.width, height: meta.height };
  } catch {
    /* metadata read failed — proceed without before-dimensions */
  }

  try {
    const trimmedBuf = await sharp(buf).trim({ threshold: 20 }).toBuffer();
    // Read after-dimensions to detect whether anything actually moved.
    const afterMeta = await sharp(trimmedBuf).metadata();
    const after =
      afterMeta.width && afterMeta.height
        ? { width: afterMeta.width, height: afterMeta.height }
        : undefined;
    const moved =
      before && after && (before.width !== after.width || before.height !== after.height);
    return { buf: trimmedBuf, trimmed: Boolean(moved), before, after };
  } catch {
    // sharp.trim throws if the entire image is uniform (no edge to
    // detect) or some other decode issue — return original.
    return { buf, trimmed: false, before };
  }
}
