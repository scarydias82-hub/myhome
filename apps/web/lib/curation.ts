// Designer-curated picking step (#179). Returns palette+room-fit
// candidates per core category for the CurationStep UI on
// /rooms/new. Distinct from fetchCompleteTheLook (which feeds the
// post-render shop-by-category carousels): this one is shown BEFORE
// the render, the user explicitly picks 1-3 per category, and the
// picks become both the heroProducts for the render AND the
// picking list (sidestepping Florence-2 + post-render matching).
//
// Behaviour:
//   - Wishlist items in each category are PINNED to the front of
//     that category's list with `isWishlisted: true`. The
//     completeTheLook tier-4 fallback was wishlist-on-empty; this is
//     wishlist-first.
//   - Designer's curated picks fill the remainder (palette + room
//     match, deduped against pinned wishlist).
//   - Only CORE_CATEGORIES_PER_ROOM are surfaced — the load-bearing
//     pieces per room type. Optional / decorative categories (art,
//     mirrors, throws, etc.) belong to the post-render shop.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseRoomTag } from '@/lib/matching';
import { getRenderRetailerAllowlist } from '@/lib/env';

// Core categories per room — the picks the user MUST commit to
// before rendering. Tight set so the picker stays short (≤4
// categories on mobile). Keys use the catalogue's room-tag taxonomy
// (matches palettes.json `recommended_rooms` + productTags.js
// CATEGORY_TO_ROOMS). Vision-only slugs like `lounge_room` are mapped
// to their catalogue equivalent via normaliseRoomTag before lookup.
export const CORE_CATEGORIES_PER_ROOM: Record<string, string[]> = {
  bedroom: ['Beds', 'Bedside Tables', 'Rugs', 'Lighting'],
  living_room: ['Sofas', 'Coffee Tables', 'Side Tables', 'Rugs'],
  dining_room: ['Dining Tables', 'Chairs', 'Lighting', 'Rugs'],
  kitchen: ['Stools', 'Lighting'],
  bathroom: ['Tapware', 'Mirrors'],
  study: ['Desks', 'Chairs', 'Lighting'],
  hallway: ['Consoles', 'Mirrors', 'Rugs'],
  outdoor: ['Chairs', 'Lighting', 'Rugs'],
};

// Fallback when room_type is null or unrecognised — typical
// living-room categories that work in most spaces.
const FALLBACK_CORE_CATEGORIES = ['Sofas', 'Coffee Tables', 'Rugs', 'Lighting'];

// Same category-family expansion as lib/matching.ts + completeTheLook
// — retailer spelling drift (Sofa vs Sofas) shouldn't drop matches.
//
// Coco Republic (#36) writes singular labels per owner directive
// ("drop the s from your label"). Other scrapers still write plural.
// Both forms are listed here so the room → core-categories queries
// keep working regardless of which scraper produced the row.
const CATEGORY_FAMILIES: Record<string, string[]> = {
  Sofas: ['Sofas', 'Sofa'],
  'Coffee Tables': ['Coffee Tables', 'Coffee Table'],
  'Side Tables': ['Side Tables', 'Side Table', 'Bedside Table', 'Bedside Tables', 'Occasional Tables', 'Occasional Table'],
  'Bedside Tables': ['Bedside Tables', 'Bedside Table'],
  Beds: ['Beds', 'Bed'],
  Chairs: ['Chairs', 'Chair', 'Armchair', 'Dining Chair', 'Lounge Chair', 'Lounge Chairs'],
  'Dining Tables': ['Dining Tables', 'Dining Table'],
  Consoles: ['Consoles', 'Console', 'Console Table'],
  Stools: ['Stools', 'Stool', 'Bar Stool'],
  Desks: ['Desks', 'Desk'],
  Tapware: ['Tapware'],
  Mirrors: ['Mirrors', 'Mirror'],
  // Lighting is the canonical room-categories key (per CORE_CATEGORIES_
  // PER_ROOM) — Coco surfaces specific lamp types as their own
  // categories (Floor Lamp / Table Lamp), and Freedom writes plural
  // 'Lamps' / 'Wall Lights'. Expand all of them under Lighting so a
  // matcher query for Lighting finds rows from any scraper.
  Lighting: ['Lighting', 'Lamp', 'Lamps', 'Floor Lamp', 'Floor Lamps', 'Table Lamp', 'Table Lamps', 'Wall Light', 'Wall Lights', 'Pendant', 'Pendants'],
};

function expandCategory(displayCategory: string): string[] {
  return CATEGORY_FAMILIES[displayCategory] ?? [displayCategory];
}

export interface CurationItem {
  id: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  /** Full multi-image array if the retailer publishes one (Coco hi-res
   *  rebuild #36). Null for single-image scrapers. The render route
   *  consumes this for multi-angle gpt-image-1 reference input. */
  imageUrls: string[] | null;
  productUrl: string;
  affiliateUrl: string | null;
  /** True when this product is in the user's wishlist — UI pins these
   *  to the front and renders a ♥ marker. */
  isWishlisted: boolean;
}

export interface CurationCategory {
  /** Display label (e.g. "Sofas"). */
  displayLabel: string;
  /** Items in this category, wishlist-pinned-first. */
  items: CurationItem[];
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  /** Multi-image array (Coco-style hi-res scrapers populate this; older
   *  single-image scrapers leave it NULL). image_urls[0] === image_url. */
  image_urls: string[] | null;
  product_url: string;
  affiliate_url: string | null;
  /** Physical dimensions in cm. Parsed at scrape time by
   *  apps/scraper/utils/parseDimensions.js (~70-80% coverage on
   *  Coco furniture rows). Any axis can be null. */
  dimensions: {
    width_cm?: number | null;
    depth_cm?: number | null;
    height_cm?: number | null;
  } | null;
}

/** Room dimensions in metres as `rooms.analysis.dimensions_approximate_m`
 *  carries them — vision-extracted, any axis can be null when the model
 *  couldn't infer it confidently. */
export interface RoomDimensions {
  width_m: number | null;
  depth_m: number | null;
  height_m: number | null;
}

interface FetchOptions {
  admin: SupabaseClient;
  /** Authenticated user id — required for wishlist pinning. */
  userId: string;
  /** room_type from rooms.analysis.room_type. Drives which core
   *  categories to surface. */
  roomType: string | null;
  /** Palette ID — filters products. */
  paletteId: string | null;
  /** Optional style tags from the picked style — used in the
   *  palette+room+style tier so curation feels editorially aligned. */
  styleTags?: string[];
  /** Optional room dimensions. When supplied, products whose largest
   *  horizontal dimension would exceed 75% of the room's shortest wall
   *  are dropped — they wouldn't fit along any wall comfortably anyway,
   *  and the picker shouldn't waste a slot on them. Missing axes (vision
   *  failed to infer) → no filter on that axis. Missing product
   *  dimensions → product is kept (we can't tell — trust curation). */
  roomDimensions?: RoomDimensions | null;
  /** Max items per category. Default 8 — leaves room for ~2 wishlist
   *  pinned + 6 designer picks on a typical category. */
  perCategory?: number;
}

// Build a predicate that returns true when a product's footprint fits
// the room. The rule of thumb: a product's largest horizontal dimension
// can't exceed 75% of the shortest room wall. 75% gives ~25% breathing
// room for circulation + adjacent furniture. Below that threshold the
// picker would otherwise surface, e.g., a 3.2m sofa in a 3m-wall bedroom
// which is technically grouped under "Sofas" but physically nonsense.
//
// Tolerant by design: when EITHER side is missing data (room.width null,
// or product.dimensions null) the predicate returns true. We'd rather
// surface an unverifiable candidate than hide it.
function makeDimensionFilter(
  room: RoomDimensions | null | undefined,
): (dims: ProductRow['dimensions']) => boolean {
  if (!room) return () => true;
  const walls = [room.width_m, room.depth_m].filter(
    (m): m is number => typeof m === 'number' && m > 0,
  );
  if (walls.length === 0) return () => true;
  const shortestWallCm = Math.min(...walls) * 100;
  const maxProductCm = shortestWallCm * 0.75;
  return (dims) => {
    if (!dims) return true;
    const w = typeof dims.width_cm === 'number' ? dims.width_cm : 0;
    const d = typeof dims.depth_cm === 'number' ? dims.depth_cm : 0;
    const maxDim = Math.max(w, d);
    if (maxDim === 0) return true;
    return maxDim <= maxProductCm;
  };
}

export async function fetchCurationCandidates({
  admin,
  userId,
  roomType,
  paletteId,
  styleTags,
  roomDimensions,
  perCategory = 8,
}: FetchOptions): Promise<CurationCategory[]> {
  const canonicalRoom = normaliseRoomTag(roomType);
  const dimensionFilter = makeDimensionFilter(roomDimensions);
  const categories = canonicalRoom
    ? (CORE_CATEGORIES_PER_ROOM[canonicalRoom] ?? FALLBACK_CORE_CATEGORIES)
    : FALLBACK_CORE_CATEGORIES;
  const roomFilter = canonicalRoom ? [canonicalRoom, 'any'] : ['any'];

  // Optional retailer scoping for test mode. When set (e.g.
  // RENDER_RETAILER_ALLOWLIST='Coco Republic'), every product query
  // here is narrowed to those retailers — both the wishlist join and
  // the designer-curated tiers. Returns null in production where the
  // env var is unset.
  const retailerAllowlist = getRenderRetailerAllowlist();

  // Load user's full wishlist with product details once. Wishlist
  // is small (≤50 typical), so the whole-pull is cheap and lets us
  // pin per-category in-memory.
  const wlRes = await admin
    .from('user_wishlist')
    .select(
      'products(id, name, retailer, category, price_aud, image_url, image_urls, product_url, affiliate_url, dimensions)',
    )
    .eq('user_id', userId);
  const wishlistRows = (wlRes.data ?? []) as unknown as Array<{
    products: ProductRow | ProductRow[] | null;
  }>;
  const wishlistByCategory = new Map<string, ProductRow[]>();
  const wishlistIds = new Set<string>();
  for (const row of wishlistRows) {
    const candidates = Array.isArray(row.products)
      ? row.products
      : row.products
        ? [row.products]
        : [];
    for (const p of candidates) {
      if (!p || !p.image_url) continue;
      // Test-mode allowlist applied to wishlist too — if we're scoping
      // renders to Coco-only, a Freedom sofa in the wishlist shouldn't
      // surface in the picker.
      if (retailerAllowlist && !retailerAllowlist.includes(p.retailer)) continue;
      wishlistIds.add(p.id);
      const bucket = wishlistByCategory.get(p.category);
      if (bucket) bucket.push(p);
      else wishlistByCategory.set(p.category, [p]);
    }
  }

  // For each core category, fetch in parallel.
  const results = await Promise.allSettled(
    categories.map(async (displayLabel) => {
      const cats = expandCategory(displayLabel);
      const selectCols =
        'id, name, retailer, category, price_aud, image_url, image_urls, product_url, affiliate_url, dimensions';

      // 1. Wishlist items in this category (pinned). Filter by
      //    expanded category family so wishlist items tagged
      //    "Bedside Table" surface under "Bedside Tables".
      const wishlistItems: ProductRow[] = [];
      for (const cat of cats) {
        const bucket = wishlistByCategory.get(cat);
        if (bucket) wishlistItems.push(...bucket);
      }

      // 2. Designer-curated catalogue — palette + room + style. Same
      //    3-tier filter as completeTheLook's primary tiers.
      const designerNeeded = Math.max(0, perCategory - wishlistItems.length);
      const designerRows: ProductRow[] = [];

      if (paletteId && styleTags && styleTags.length > 0 && designerNeeded > 0) {
        let qb = admin.from('products').select(selectCols);
        if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
        const q = await qb
          .in('category', cats)
          .not('image_url', 'is', null)
          .contains('palette_tags', [paletteId])
          .overlaps('room_tags', roomFilter)
          .overlaps('style_tags', styleTags)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(designerNeeded * 2);
        if (!q.error && q.data) designerRows.push(...(q.data as ProductRow[]));
      }
      if (paletteId && designerRows.length < designerNeeded) {
        let qb = admin.from('products').select(selectCols);
        if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
        const q = await qb
          .in('category', cats)
          .not('image_url', 'is', null)
          .contains('palette_tags', [paletteId])
          .overlaps('room_tags', roomFilter)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(designerNeeded * 2);
        if (!q.error && q.data) designerRows.push(...(q.data as ProductRow[]));
      }
      if (designerRows.length < designerNeeded) {
        let qb = admin.from('products').select(selectCols);
        if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
        const q = await qb
          .in('category', cats)
          .not('image_url', 'is', null)
          .overlaps('room_tags', roomFilter)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(designerNeeded * 2);
        if (!q.error && q.data) designerRows.push(...(q.data as ProductRow[]));
      }
      // Tier 4 — category only. Safety net mirroring the legacy
      // fallback in lib/matching.ts:fetchCandidates: if room_tags
      // taxonomy drift (or a vision slug we don't yet alias) leaves
      // tiers 1-3 empty, surface SOMETHING in the category so the
      // user is never stuck with an empty picker.
      if (designerRows.length < designerNeeded) {
        let qb = admin.from('products').select(selectCols);
        if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
        const q = await qb
          .in('category', cats)
          .not('image_url', 'is', null)
          .order('price_aud', { ascending: false, nullsFirst: false })
          .limit(designerNeeded * 2);
        if (!q.error && q.data) designerRows.push(...(q.data as ProductRow[]));
      }

      // 3. Merge wishlist-pinned + designer, dedupe by id, apply
      //    dimension filter, cap. Wishlist items deliberately bypass
      //    the dimension filter — the user explicitly chose them, so
      //    don't second-guess; if it doesn't fit, that's their call.
      const seen = new Set<string>(wishlistItems.map((r) => r.id));
      const merged: Array<{ row: ProductRow; isWishlisted: boolean }> = wishlistItems.map(
        (r) => ({ row: r, isWishlisted: true }),
      );
      for (const r of designerRows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (!dimensionFilter(r.dimensions)) continue;
        merged.push({ row: r, isWishlisted: false });
        if (merged.length >= perCategory) break;
      }

      return {
        displayLabel,
        items: merged.map(({ row, isWishlisted }) => ({
          id: row.id,
          name: row.name,
          retailer: row.retailer,
          category: row.category,
          priceAud: row.price_aud,
          imageUrl: row.image_url,
          imageUrls: row.image_urls,
          productUrl: row.product_url,
          affiliateUrl: row.affiliate_url,
          isWishlisted,
        })) as CurationItem[],
      } satisfies CurationCategory;
    }),
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : ({ displayLabel: categories[i] ?? 'Other', items: [] } satisfies CurationCategory),
  );
}
