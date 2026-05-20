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
