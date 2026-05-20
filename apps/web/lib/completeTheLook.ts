// Complete-the-look — category-aligned shopping list that sits
// alongside the detection-based hotspot picking list (#116).
//
// The hotspot list answers "what am I looking at?" — Florence-2
// detected a bed at (x, y), here are 5 beds you can buy. Useful but
// limited: the render frame doesn't show every category a user might
// shop. A bedroom render might include the bed + bedside table + rug
// but miss cushions, throws, art, table lamps, curtains.
//
// Complete-the-look fills that gap. Per room type, we know which
// categories belong to a typical room. For each category we query
// the catalog for products that match the render's palette + style,
// limit to 3 per category, and surface them as a grid below the
// hotspot picking list.
//
// Pure DB query — no Claude call. The Round 17 metadata (palette_tags,
// room_tags, style_tags) does the heavy lifting. #129 will replace
// this metadata-only pick with Claude-curated reasoning for the
// first Fal pass; #116 stays as the broader "everything else you'd
// shop" panel below.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickingMatch } from '@/components/renders/picking-list-panel';

// ROOM_CATEGORY_MANIFEST — which catalog categories belong to which
// room type. Each entry maps to a `Category Family` that
// CATEGORY_FAMILIES in lib/matching.ts expands into the actual
// product categories used by retailers (handles "Sofas" vs "Sofa"
// vs "Sectional" etc).
export const ROOM_CATEGORY_MANIFEST: Record<string, string[]> = {
  bedroom: [
    'Beds',
    'Bedside Tables',
    'Quilt Covers',
    'Cushions',
    'Throws',
    'Rugs',
    'Art',
    'Lighting',
    'Curtains',
    'Mirrors',
  ],
  living_room: [
    'Sofas',
    'Coffee Tables',
    'Side Tables',
    'Cushions',
    'Throws',
    'Rugs',
    'Art',
    'Lighting',
    'Curtains',
    'Mirrors',
  ],
  lounge_room: [
    'Sofas',
    'Coffee Tables',
    'Side Tables',
    'Cushions',
    'Throws',
    'Rugs',
    'Art',
    'Lighting',
    'Curtains',
    'Mirrors',
  ],
  dining_room: ['Dining Tables', 'Chairs', 'Sideboards', 'Lighting', 'Art', 'Rugs', 'Mirrors'],
  kitchen: ['Tiles', 'Tapware', 'Lighting', 'Bookcases', 'Stools', 'Art'],
  bathroom: ['Tapware', 'Tiles', 'Bathroom Accessories', 'Shower', 'Mirrors', 'Paint'],
  study: ['Desks', 'Storage & Desks', 'Chairs', 'Lighting', 'Art', 'Bookcases', 'Rugs'],
  hallway: ['Consoles', 'Mirrors', 'Lighting', 'Art', 'Rugs'],
  outdoor: ['Lighting', 'Art', 'Rugs', 'Chairs'],
};

// Fallback when room_type is null or unrecognised — covers the common
// categories that work in most spaces.
const FALLBACK_CATEGORIES = [
  'Sofas',
  'Side Tables',
  'Cushions',
  'Throws',
  'Rugs',
  'Art',
  'Lighting',
  'Mirrors',
];

// Same category-family expansion as lib/matching.ts so retailer
// spelling drift (Sofa vs Sofas, Bedside Table vs Side Tables) doesn't
// silently drop categories. Duplicated rather than imported to keep
// the server-side fetch lightweight.
const CATEGORY_FAMILIES: Record<string, string[]> = {
  Curtains: ['Curtains', 'Curtains - Sheers', 'Curtains - Blockout'],
  'Side Tables': ['Side Tables', 'Bedside Table', 'Bedside Tables', 'Occasional Tables'],
  'Bedside Tables': ['Bedside Tables', 'Bedside Table', 'Side Tables'],
  Sofas: ['Sofas', 'Sofa'],
  Beds: ['Beds', 'Bed'],
  Chairs: ['Chairs', 'Chair', 'Armchair', 'Dining Chair'],
  'Coffee Tables': ['Coffee Tables', 'Coffee Table'],
  Tables: ['Tables', 'Table'],
  Consoles: ['Consoles', 'Console Table'],
  'Storage & Desks': ['Storage & Desks', 'Storage System', 'Wardrobe', 'Desks'],
  'Bathroom Accessories': ['Bathroom Accessories'],
};

function expandCategory(displayCategory: string): string[] {
  return CATEGORY_FAMILIES[displayCategory] ?? [displayCategory];
}

export interface CompleteTheLookCategory {
  displayLabel: string; // e.g. "Cushions"
  products: PickingMatch[];
}

interface FetchOptions {
  admin: SupabaseClient;
  /** room_type from rooms.analysis.room_type — bedroom / living_room /
   *  bathroom etc. Drives which categories to fetch. */
  roomType: string | null;
  /** Palette ID from the render's style_profile. Filters products. */
  paletteId: string | null;
  /** Style slug from the render's style_profile. Used for style_tags
   *  filtering when provided. */
  styleTags?: string[];
  /** Cap products per category — default 3. The UI shows a 3-up grid
   *  per category by default. */
  perCategory?: number;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
  dimensions:
    | {
        width_cm?: number | null;
        depth_cm?: number | null;
        height_cm?: number | null;
        hex?: string | null;
      }
    | null;
}

export async function fetchCompleteTheLook({
  admin,
  roomType,
  paletteId,
  styleTags,
  perCategory = 3,
}: FetchOptions): Promise<CompleteTheLookCategory[]> {
  // Normalise room_type to manifest keys (sometimes Claude returns
  // "lounge" instead of "lounge_room" etc).
  const normalisedRoom = (roomType ?? '').toLowerCase().replace(/\s+/g, '_');
  const categories = ROOM_CATEGORY_MANIFEST[normalisedRoom] ?? FALLBACK_CATEGORIES;

  // For room context filtering, include the room slug + 'any' sentinel
  // so room-agnostic products (paint with room_tags=['any']) surface.
  const roomFilter = normalisedRoom ? [normalisedRoom, 'any'] : ['any'];

  // Fire all category queries in parallel — they're independent and
  // each query is small (3 rows). Promise.allSettled lets a single
  // empty category gracefully degrade without taking down the section.
  const results = await Promise.allSettled(
    categories.map(async (displayLabel) => {
      const cats = expandCategory(displayLabel);
      const selectCols =
        'id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions';

      // Tier 1: palette + room + style match. The ideal pick.
      if (paletteId && styleTags && styleTags.length > 0) {
        const q = admin
          .from('products')
          .select(selectCols)
          .in('category', cats)
          .not('image_url', 'is', null)
          .contains('palette_tags', [paletteId])
          .overlaps('room_tags', roomFilter)
          .overlaps('style_tags', styleTags)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(perCategory);
        const tier1 = await q;
        if (!tier1.error && tier1.data && tier1.data.length > 0) {
          return { displayLabel, rows: tier1.data as ProductRow[] };
        }
      }

      // Tier 2: palette + room only. Wider net.
      if (paletteId) {
        const q = admin
          .from('products')
          .select(selectCols)
          .in('category', cats)
          .not('image_url', 'is', null)
          .contains('palette_tags', [paletteId])
          .overlaps('room_tags', roomFilter)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(perCategory);
        const tier2 = await q;
        if (!tier2.error && tier2.data && tier2.data.length > 0) {
          return { displayLabel, rows: tier2.data as ProductRow[] };
        }
      }

      // Tier 3: category + room only. Last resort so categories
      // without strong palette coverage still surface something.
      const q3 = admin
        .from('products')
        .select(selectCols)
        .in('category', cats)
        .not('image_url', 'is', null)
        .overlaps('room_tags', roomFilter)
        .order('price_aud', { ascending: false, nullsFirst: false })
        .limit(perCategory);
      const tier3 = await q3;
      if (!tier3.error && tier3.data && tier3.data.length > 0) {
        return { displayLabel, rows: tier3.data as ProductRow[] };
      }

      // Empty — category genuinely uncovered in the catalog.
      return { displayLabel, rows: [] as ProductRow[] };
    }),
  );

  return results
    .map((r, idx) => {
      const displayLabel = categories[idx] ?? 'Other';
      if (r.status === 'rejected') {
        return { displayLabel, products: [] };
      }
      return {
        displayLabel: r.value.displayLabel,
        products: r.value.rows.map((p, position) => productRowToMatch(p, position)),
      };
    })
    .filter((c) => c.products.length > 0);
}

function productRowToMatch(p: ProductRow, position: number): PickingMatch {
  return {
    productId: p.id,
    name: p.name,
    retailer: p.retailer,
    category: p.category,
    priceAud: p.price_aud,
    imageUrl: p.image_url,
    productUrl: p.product_url,
    affiliateUrl: p.affiliate_url,
    similarity: Math.max(0, 1 - position * 0.1),
    hex: p.dimensions?.hex ?? null,
    dimensions: p.dimensions
      ? {
          width_cm: p.dimensions.width_cm ?? null,
          depth_cm: p.dimensions.depth_cm ?? null,
          height_cm: p.dimensions.height_cm ?? null,
        }
      : null,
  };
}
