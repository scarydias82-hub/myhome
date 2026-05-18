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
