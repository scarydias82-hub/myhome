// Shared catalog colour filter.
//
// Every scraped product runs through this at ingest time. We extract a
// dominant colour from the product image, compare it against every app
// palette's hexes, and tag the row with the IDs of palettes it could
// plausibly belong to. Products that match no palette are dropped —
// they'd never surface in a picking list anyway, so we don't want them
// in the DB.
//
// Dominant-colour heuristic: centre 50% crop, then resize-to-1px. The
// centre crop avoids the white-background bias common in catalog
// photography (a navy doona shot on a white seamless would otherwise
// average to pale blue). Resize-to-1 then takes the perceptual mean of
// the cropped region.
//
// For paint products (Dulux et al.) the scraper already records the
// swatch hex in dimensions.hex. We pass that through as `existingHex`
// and use it directly — retailer-published colour beats image
// extraction every time.

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { USER_AGENT } from './userAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALETTES_PATH = path.resolve(__dirname, '../../web/lib/palettes.json');

const palettesJson = JSON.parse(await readFile(PALETTES_PATH, 'utf-8'));
const PALETTES = palettesJson.palettes;

// Perceptual distance threshold (CIE Lab ΔE76).
//
// Why Lab not RGB: in RGB-Euclidean space, dark brown (Walnut) and dark
// teal end up close because they share luminance — even though human
// vision reads them as completely different colours. Lab separates
// luminance (L*) from hue/chroma (a*, b*), so distance reflects actual
// perceived difference.
//
// ΔE scale (well-established):
//    0–1   not visible to humans
//    1–2   barely noticeable
//    2–10  noticeable
//   10–25  same tonal family
//   25–50  related but clearly different
//   50+   different colour
//
// Default 20 = "this product belongs to that palette's tonal family".
// Tuned from sweep against the 10 app palettes: 20 catches Walnut in
// warm earthy palettes only, keeps Teal out of mossy-green-ochre, and
// excludes off-palette hues (hot pink, neon green) cleanly.
// Override via PALETTE_MATCH_THRESHOLD for further tuning.
const THRESHOLD = Number(process.env.PALETTE_MATCH_THRESHOLD) || 20;

export function parseHex(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// Kept for compatibility with anything that imports it; Lab is what
// the matcher actually uses now.
export function rgbDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// sRGB → linear RGB → XYZ (D65) → Lab. Standard pipeline, gamma 2.4
// approximation per IEC 61966-2-1.
function sRgbToLinear(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function rgbToLab({ r, g, b }) {
  const lr = sRgbToLinear(r);
  const lg = sRgbToLinear(g);
  const lb = sRgbToLinear(b);
  // sRGB D65 → XYZ
  const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const Z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  // D65 white point, then XYZ → Lab
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE(la, lb) {
  return Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

function hexToLab(hex) {
  const rgb = parseHex(hex);
  return rgb ? rgbToLab(rgb) : null;
}

export function toHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Returns the dominant hex for a product image, or null if the fetch /
// decode fails. We use a centre-50% crop then resize-to-1px so the
// answer reflects the product, not the seamless white background.
export async function extractDominantHex(imageUrl) {
  if (!imageUrl) return null;
  let buf;
  try {
    const res = await fetch(imageUrl, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return null;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const cropW = Math.max(1, Math.floor(meta.width * 0.5));
    const cropH = Math.max(1, Math.floor(meta.height * 0.5));
    const offsetX = Math.floor((meta.width - cropW) / 2);
    const offsetY = Math.floor((meta.height - cropH) / 2);
    const { data } = await sharp(buf)
      .extract({ left: offsetX, top: offsetY, width: cropW, height: cropH })
      .removeAlpha()
      .resize(1, 1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return toHex({ r: data[0], g: data[1], b: data[2] });
  } catch {
    return null;
  }
}

// Returns the IDs of every palette this hex could belong to. Empty
// result = the product doesn't fit any palette in the app and should
// be skipped by the ingest step.
export function tagWithPalettes(hex) {
  const lab = hexToLab(hex);
  if (!lab) return [];
  const matches = [];
  for (const palette of PALETTES) {
    for (const colour of palette.colors) {
      const target = hexToLab(colour.hex);
      if (!target) continue;
      if (deltaE(lab, target) <= THRESHOLD) {
        matches.push(palette.id);
        break;
      }
    }
  }
  return matches;
}

// Convenience: handles the paint fast path (existing dimensions.hex
// from the Dulux scraper) so we don't waste a fetch + decode on a
// swatch image when we already have the retailer-published hex.
//
// Returns { hex, tags } — hex is the colour we decided on (existing
// or freshly extracted), tags is the list of palette IDs it matches.
export async function classifyProduct({ imageUrl, existingHex }) {
  const hex = existingHex || (await extractDominantHex(imageUrl));
  if (!hex) return { hex: null, tags: [] };
  return { hex, tags: tagWithPalettes(hex) };
}
