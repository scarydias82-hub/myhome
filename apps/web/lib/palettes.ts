// Typed reader over apps/web/lib/palettes.json — the canonical AU interior
// design palette catalogue. Used by the designer LLM (as SELECTED_PALETTE)
// and by the palette picker UI.

import raw from './palettes.json';

export type RoomRole = 'wall' | 'sofa' | 'floor' | 'accent' | 'trim';

export interface PaletteColorRef {
  name: string;
  hex: string;
}

export interface PaletteColor {
  id: string;
  name: string;
  hex: string;
  role: RoomRole;
  rgb: [number, number, number];
}

/** Persona axes the brief synthesiser uses to match palette to person.
 *  See lib/brief/synthesiser.ts — each palette is tagged with one value
 *  per axis (sometimes multiple — a palette that works for both safe
 *  and adventurous personas will include both). */
export type PersonaAxis =
  | 'safe'
  | 'adventurous'
  | 'timeless'
  | 'of-the-moment'
  | 'quiet'
  | 'vibrant'
  | 'contemporary'
  | 'heritage';

export interface Palette {
  id: string;
  name: string;
  vibe: string;
  trend_source: string;
  tags: string[];
  recommended_rooms: string[];
  pairs_with_materials: string[];
  app_note: string;
  style_tags: string[];
  room_roles: Record<RoomRole, PaletteColorRef>;
  colors: PaletteColor[];
  /** 1 = trend-of-the-year, 10 = heirloom timeless. Surfaced on
   *  palette cards so users see how durable the choice is. */
  timelessness: number;
  /** Persona axes this palette fits — used by the brief synthesiser
   *  as hard signal rather than vibe inference. */
  persona_fit: PersonaAxis[];
}

interface PaletteFile {
  version: string;
  generated: string;
  description: string;
  palettes: Palette[];
}

const file = raw as PaletteFile;

export const PALETTES: Palette[] = file.palettes;

export function listPalettes(): Palette[] {
  return PALETTES;
}

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

// Quick helper for the picker thumbnail: the five swatches in role order.
export function paletteSwatch(p: Palette): string[] {
  const order: RoomRole[] = ['wall', 'sofa', 'floor', 'accent', 'trim'];
  return order.map((r) => p.room_roles[r].hex);
}

// Perceptual brightness of a palette — used to sort carousels lightest → darkest.
// Uses the wall colour as the dominant-surface proxy and the standard sRGB
// relative luminance formula (IEC 61966-2-1) so the sort matches what the
// human eye actually sees rather than raw RGB average.
export function paletteBrightness(p: Palette): number {
  const hex = p.room_roles.wall.hex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  // sRGB → linear
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// -----------------------------------------------------------------
// Trend vs timeless direction (#167)
// -----------------------------------------------------------------
//
// Every palette carries a `timelessness: 1-10` score. The UI splits
// the 56-palette catalogue into two carousels by this score:
//   - 2026 Design Trends (carousel ②) — trend-forward, from sources
//     like WGSN / Pantone / Sherwin-Williams / Benjamin Moore
//     Colour-of-the-Year picks. Lower timelessness.
//   - Tried & tested (carousel ③) — heritage / classical palettes
//     grounded in Hamptons / Federation / Mid-Century / modernist
//     frameworks. Higher timelessness.
//
// Before this constant the threshold was duplicated across the
// codebase (`< 9` in two places, `< 7` in /api/recommend) which
// produced a banner-label mismatch — a palette at timelessness 7 or 8
// showed in carousel ② but /api/recommend's response said
// direction='timeless'. Centralised here so future tuning happens
// in one place.
//
// Numbers chosen so palettes 1-8 are trend-forward and 9-10 are
// heritage. This matches the carousel split that was already live
// in the picker.

/** Palettes with `timelessness < TRENDS_CUTOFF` are trend-forward;
 *  the rest are heritage / classical. */
export const TRENDS_CUTOFF = 9;

/** True when the palette belongs in the 2026 Design Trends carousel. */
export function isTrendForward(palette: Palette): boolean {
  return palette.timelessness < TRENDS_CUTOFF;
}

/** True when the palette belongs in the Tried & tested carousel. */
export function isTimeless(palette: Palette): boolean {
  return palette.timelessness >= TRENDS_CUTOFF;
}

/** Derived UI label for the inheritance banner / brief recommendation.
 *  Returns null when palette is undefined (caller didn't resolve an id). */
export function paletteDirection(palette: Palette | undefined | null): '2026' | 'timeless' | null {
  if (!palette) return null;
  return isTrendForward(palette) ? '2026' : 'timeless';
}

// Reverse-lookup a palette id from a hex array — used by the picking-list
// builder to recover the palette id from style_profiles.palette (which
// only stores hex codes). Match is exact-set-equality on lower-cased
// hexes so we don't accidentally collide on palettes that share a single
// colour (most palettes share the same espresso/black trim hex).
export function findPaletteByHexes(hexes: string[] | null | undefined): Palette | null {
  if (!hexes || hexes.length === 0) return null;
  const want = new Set(hexes.map((h) => h.toLowerCase()));
  for (const p of PALETTES) {
    const have = new Set(p.colors.map((c) => c.hex.toLowerCase()));
    if (have.size !== want.size) continue;
    let allMatch = true;
    for (const h of want) {
      if (!have.has(h)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return p;
  }
  return null;
}
