// Auto-pick palette-matched catalogue items to inject as "hero" products
// into the render prompt.
//
// Before this lived, Fal/Flux re-imagined every soft furnishing
// generically — "linen bedding" became Flux's idea of generic linen, not
// an Adairs Mason Quilt Cover. The catalog only entered the picture
// AFTER the render via the picking-list match. That meant the rendered
// duvet never resembled an actual product you could buy.
//
// This module closes part of that gap cheaply: when the user picks a
// palette but doesn't explicitly select featured products, we query
// the palette-tagged catalogue for room-appropriate items, dedupe by
// category for variety, and pass the top N as `heroProducts` so
// buildPrompt names them in the Flux prompt ("featuring Adairs Mason
// quilt cover in pecan, Coco Republic Eldron bed, Freedom Vinta rug").
// Flux still paints a generic interpretation but anchors closer to a
// real product. ~40% closure of the catalog-to-render gap; the other
// 60% needs IP-Adapter or post-render composite (tasks deferred).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HeroProductDescriptor } from '@/lib/styles';

// Category labels used by individual scrapers — they don't agree on
// plural vs singular (Poliform writes "Sofa", Koala writes "Sofas") so
// the hints lists include both forms. The query uses `.in()` which is
// an exact-match, so we list every variant explicitly.
const ROOM_CATEGORY_HINTS: Record<string, string[]> = {
  bedroom: [
    'Quilt Covers',
    'Bed', 'Beds',
    'Bedside Table', 'Bedside Tables',
    'Wardrobe',
    'Rugs', 'Carpet',
    'Curtains - Sheers', 'Curtains - Blockout',
  ],
  living_room: [
    'Sofa', 'Sofas',
    'Armchair', 'Chair', 'Chairs',
    'Coffee Table', 'Coffee Tables',
    'Occasional Tables',
    'Sideboards',
    'Mirrors',
    'Rugs', 'Carpet',
    'Curtains - Sheers',
    'Lighting',
  ],
  lounge_room: [
    'Sofa', 'Sofas',
    'Armchair',
    'Coffee Table', 'Coffee Tables',
    'Rugs', 'Carpet',
    'Lighting',
  ],
  dining_room: [
    'Dining',
    'Table', 'Tables',
    'Chair', 'Chairs',
    'Lighting',
  ],
  kitchen: ['Stools', 'Lighting'],
  bathroom: ['Curtains - Sheers'],
  study: ['Desk', 'Chair', 'Chairs', 'Storage System', 'Rugs', 'Lighting'],
};

const DEFAULT_HINTS = ['Sofa', 'Sofas', 'Rugs', 'Lighting'];

export function categoriesForRoom(roomType: string | null | undefined): string[] {
  if (!roomType) return DEFAULT_HINTS;
  // Normalise "Living Room" / "living-room" / "living_room" / "LIVING" all to
  // "living_room". Then match any key the room type contains.
  const norm = roomType.toLowerCase().replace(/[\s-]+/g, '_');
  for (const [key, cats] of Object.entries(ROOM_CATEGORY_HINTS)) {
    if (norm.includes(key) || key.includes(norm)) return cats;
  }
  // "living" matches "living_room"; "bed" matches "bedroom" via the
  // key.includes(norm) check above. Anything else → defaults.
  return DEFAULT_HINTS;
}

// Query the products table for palette-matched, room-appropriate items.
// Returns up to `limit` HeroProductDescriptors, deduplicated by category
// so we don't get e.g. three quilt covers when one quilt + one bed +
// one rug is what we want. Skips Dulux (paint goes into the prompt via
// the palette directive, not as a featured object).
export async function autoFeatureForPalette({
  admin,
  paletteId,
  roomType,
  limit = 3,
}: {
  admin: SupabaseClient;
  paletteId: string;
  roomType: string | null | undefined;
  limit?: number;
}): Promise<HeroProductDescriptor[]> {
  const cats = categoriesForRoom(roomType);
  if (cats.length === 0) return [];
  // Pull a pool (5x limit) so we have room to dedupe by category and
  // still hit `limit`. Order by id for deterministic results — same
  // palette+room renders should auto-feature the same products
  // session-to-session, which makes eval iteration reproducible.
  const { data, error } = await admin
    .from('products')
    .select('name, category, retailer')
    .contains('palette_tags', [paletteId])
    .in('category', cats)
    .neq('retailer', 'Dulux')
    .order('id', { ascending: true })
    .limit(limit * 6);
  if (error) {
    console.warn('[featuring] auto-pick query failed', error.message);
    return [];
  }
  if (!data?.length) return [];

  // One per category for variety.
  const seenCats = new Set<string>();
  const picked: HeroProductDescriptor[] = [];
  for (const p of data as Array<{ name: string; category: string; retailer: string }>) {
    if (seenCats.has(p.category)) continue;
    seenCats.add(p.category);
    picked.push({ name: p.name, category: p.category, retailer: p.retailer });
    if (picked.length >= limit) break;
  }
  return picked;
}
