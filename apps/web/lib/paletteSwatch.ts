// Generates a palette reference image to feed to Flux via IP-Adapter.
//
// Across 5 eval rounds (2026-05-19/20), palette adherence has been
// stuck at 2-4/10 regardless of how we structure the text prompt.
// Named colour vocab ("warm wheat tones"), enriched synonyms,
// adversarial NO-lists, explicit role-coloured descriptors — none of
// it broke the ceiling. Conclusion: Flux's training has only loose
// associations between paint names and hex values; only VISUAL
// conditioning can deliver pixel-exact palette adherence.
//
// This module generates a 512x512 PNG with horizontal stripes in the
// palette's 5 role colours (wall, sofa, floor, accent, trim, in that
// order — wall on top because the wall is the largest visual surface
// in any room). The image gets uploaded to fal storage and passed as
// `ip_adapters[0].image_url` to fal-ai/flux-general/image-to-image,
// which conditions the generation on the visual palette in addition
// to the canny structure-control and the text prompt.

import sharp from 'sharp';

export interface PaletteSwatchInput {
  name?: string;
  colors?: Array<{ hex: string; role?: string | null; name?: string | null }>;
  room_roles?: Record<string, { hex: string; name?: string }>;
}

// Order matters. Wall first (top of image, largest visual block in
// a typical room). Trim last (smallest accent area).
const STRIPE_ORDER = ['wall', 'sofa', 'floor', 'accent', 'trim'] as const;
const SWATCH_SIZE = 512;
const FALLBACK_GREY = { r: 136, g: 136, b: 136 };

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function resolveRoleColour(
  palette: PaletteSwatchInput,
  role: (typeof STRIPE_ORDER)[number],
): { r: number; g: number; b: number } {
  // Prefer the typed room_roles map (canonical source — see lib/palettes.ts).
  if (palette.room_roles && palette.room_roles[role]?.hex) {
    const rgb = parseHex(palette.room_roles[role].hex);
    if (rgb) return rgb;
  }
  // Fall back to colors[] by role match.
  if (palette.colors) {
    const match = palette.colors.find((c) => c.role === role);
    if (match) {
      const rgb = parseHex(match.hex);
      if (rgb) return rgb;
    }
  }
  return FALLBACK_GREY;
}

export async function generatePaletteSwatch(palette: PaletteSwatchInput): Promise<Buffer> {
  const stripeColours = STRIPE_ORDER.map((role) => resolveRoleColour(palette, role));
  const stripeHeight = Math.floor(SWATCH_SIZE / stripeColours.length);

  // Build raw RGB pixel buffer, stripe-by-stripe.
  const raw = Buffer.alloc(SWATCH_SIZE * SWATCH_SIZE * 3);
  for (let y = 0; y < SWATCH_SIZE; y++) {
    // Last stripe fills any remainder if SIZE doesn't divide evenly.
    const stripeIdx = Math.min(Math.floor(y / stripeHeight), stripeColours.length - 1);
    const stripe = stripeColours[stripeIdx] ?? FALLBACK_GREY;
    const { r, g, b } = stripe;
    const rowStart = y * SWATCH_SIZE * 3;
    for (let x = 0; x < SWATCH_SIZE; x++) {
      const i = rowStart + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }

  return sharp(raw, { raw: { width: SWATCH_SIZE, height: SWATCH_SIZE, channels: 3 } })
    .png()
    .toBuffer();
}
