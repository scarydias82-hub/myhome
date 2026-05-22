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
import { rankCandidatesByPrefs, type VisionProfile } from '@/lib/prefs-vision-fit';

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
  /** Provenance for the products in this category. Helps the UI
   *  optionally label fallback origins ("From your saved items" /
   *  "From your taste profile") and is useful in logs. */
  source: 'palette' | 'mixed' | 'user_signal' | 'empty';
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
  /** Authenticated user id — enables the user-signal fallback tier
   *  (wishlist + prefs match) when the palette/room/style match returns
   *  thin or empty results. When null, behaviour matches the legacy
   *  3-tier filter only. */
  userId?: string | null;
  /** Brief tags resolved by the same priority chain /api/render uses
   *  (override → project brief → users.preferences → []). Drives the
   *  prefs-vision-fit ranker inside the user-signal fallback. When
   *  empty, only the wishlist half of the fallback fires. */
  briefTags?: string[];
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

// Extended row shape used by the user-signal fallback tier — needs the
// vision_profile column for prefs-vision-fit scoring. Kept separate so
// the existing 3-tier filter SELECTs stay small.
interface ProductRowWithVP extends ProductRow {
  vision_profile: VisionProfile | null;
}

const SELECT_COLS_WITH_VP =
  'id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions, vision_profile';

export async function fetchCompleteTheLook({
  admin,
  roomType,
  paletteId,
  styleTags,
  perCategory = 3,
  userId,
  briefTags,
}: FetchOptions): Promise<CompleteTheLookCategory[]> {
  // Normalise room_type to manifest keys (sometimes Claude returns
  // "lounge" instead of "lounge_room" etc).
  const normalisedRoom = (roomType ?? '').toLowerCase().replace(/\s+/g, '_');
  const categories = ROOM_CATEGORY_MANIFEST[normalisedRoom] ?? FALLBACK_CATEGORIES;

  // For room context filtering, include the room slug + 'any' sentinel
  // so room-agnostic products (paint with room_tags=['any']) surface.
  const roomFilter = normalisedRoom ? [normalisedRoom, 'any'] : ['any'];

  // Pre-fetch the user's full wishlist once. The fallback tier filters
  // these per category in-memory rather than running N category-bounded
  // wishlist queries. Wishlists are small (typically < 50 items per
  // user), so the whole-pull is cheap.
  const wishlistByCategory = await loadWishlistByCategory(admin, userId ?? null);

  // Fire all category queries in parallel — they're independent and
  // each query is small (3 rows). Promise.allSettled lets a single
  // empty category gracefully degrade without taking down the section.
  const results = await Promise.allSettled(
    categories.map(async (displayLabel): Promise<{
      displayLabel: string;
      rows: ProductRow[];
      source: CompleteTheLookCategory['source'];
    }> => {
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
        if (!tier1.error && tier1.data && tier1.data.length >= perCategory) {
          return { displayLabel, rows: tier1.data as ProductRow[], source: 'palette' };
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
        if (!tier2.error && tier2.data && tier2.data.length >= perCategory) {
          return { displayLabel, rows: tier2.data as ProductRow[], source: 'palette' };
        }
      }

      // Tier 3: category + room only. Last resort that still hits the
      // palette-blind catalogue. Held to a softer threshold (>=1) so a
      // genuinely thin category still gets supplemented by user signals
      // below rather than going empty.
      const q3 = admin
        .from('products')
        .select(selectCols)
        .in('category', cats)
        .not('image_url', 'is', null)
        .overlaps('room_tags', roomFilter)
        .order('price_aud', { ascending: false, nullsFirst: false })
        .limit(perCategory);
      const tier3 = await q3;
      const palettePool: ProductRow[] = !tier3.error && tier3.data ? (tier3.data as ProductRow[]) : [];

      if (palettePool.length >= perCategory) {
        return { displayLabel, rows: palettePool, source: 'palette' };
      }

      // Tier 4 — user-signal fallback. Combines: (a) products the user
      // has wishlisted in this category (most personal), (b) products
      // that score well against the user's preference tags via the
      // prefs-vision-fit ranker (#156). Always runs when the palette
      // tiers are thin and we have ANY user signal to lean on.
      const needed = perCategory - palettePool.length;
      const excludeIds = new Set(palettePool.map((p) => p.id));
      const supplement = await fetchUserSignalProducts({
        admin,
        cats,
        userId: userId ?? null,
        wishlistByCategory,
        briefTags: briefTags ?? [],
        roomFilter,
        excludeIds,
        limit: needed,
      });

      const merged = [...palettePool, ...supplement];
      const source: CompleteTheLookCategory['source'] =
        merged.length === 0
          ? 'empty'
          : palettePool.length > 0 && supplement.length > 0
            ? 'mixed'
            : palettePool.length > 0
              ? 'palette'
              : 'user_signal';

      return { displayLabel, rows: merged, source };
    }),
  );

  // Per the post-render "every category has a story" contract (#163):
  // we do NOT filter empty categories out. The UI can render an
  // empty-state card per category if it wants ("No matches yet for
  // <category>"), but the carousel grid stays at a stable count so
  // users know which categories exist for their room type.
  return results.map((r, idx) => {
    const displayLabel = categories[idx] ?? 'Other';
    if (r.status === 'rejected') {
      return { displayLabel, products: [], source: 'empty' as const };
    }
    return {
      displayLabel: r.value.displayLabel,
      products: r.value.rows.map((p, position) => productRowToMatch(p, position)),
      source: r.value.source,
    };
  });
}

// ---------------------------------------------------------------------
// User-signal fallback (#163)
// ---------------------------------------------------------------------
//
// Used by tier 4 of fetchCompleteTheLook to supplement thin or empty
// palette-matched results. Two ingredients:
//   1. The user's wishlist intersected with the target category — the
//      products they've explicitly saved are the strongest personal
//      signal we have.
//   2. Catalogue rows in the category, scored by prefs-vision-fit and
//      sorted desc. Rows without a vision_profile yet score neutral
//      and rank alongside un-preferred candidates (same graceful
//      degradation as #156).
//
// Wishlist is loaded once per render via loadWishlistByCategory() and
// passed in here — saves N round-trips when many categories are thin.

interface WishlistMap {
  /** category (case-preserved as stored on products) → product rows */
  byCategory: Map<string, ProductRow[]>;
  /** every wishlisted product id (across all categories) — used for
   *  excludes when the prefs ranker pulls a fresh slice from products
   *  so the same row doesn't appear twice in one carousel. */
  ids: Set<string>;
}

async function loadWishlistByCategory(
  admin: SupabaseClient,
  userId: string | null,
): Promise<WishlistMap> {
  const empty: WishlistMap = { byCategory: new Map(), ids: new Set() };
  if (!userId) return empty;
  // Single join via Supabase's foreign-table embed syntax — keeps it
  // to one round-trip even when the user has 50+ saved items.
  const res = await admin
    .from('user_wishlist')
    .select(
      'products(id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions)',
    )
    .eq('user_id', userId);
  if (res.error || !res.data) return empty;

  const byCategory = new Map<string, ProductRow[]>();
  const ids = new Set<string>();
  // Supabase JS types the foreign-table embed as T[] regardless of
  // FK cardinality. `user_wishlist.product_id → products.id` is
  // many-to-one so each row's `products` always has exactly one
  // element (or zero if the FK target is missing). Normalise both
  // shapes here so callers see flat ProductRow values.
  const rows = res.data as unknown as Array<{ products: ProductRow | ProductRow[] | null }>;
  for (const row of rows) {
    const candidates = Array.isArray(row.products)
      ? row.products
      : row.products
        ? [row.products]
        : [];
    for (const p of candidates) {
      if (!p || !p.image_url) continue;
      ids.add(p.id);
      const bucket = byCategory.get(p.category);
      if (bucket) bucket.push(p);
      else byCategory.set(p.category, [p]);
    }
  }
  return { byCategory, ids };
}

interface FetchUserSignalOptions {
  admin: SupabaseClient;
  cats: string[];
  userId: string | null;
  wishlistByCategory: WishlistMap;
  briefTags: string[];
  roomFilter: string[];
  /** Product ids already included from the palette tiers — never
   *  re-emit one of these. */
  excludeIds: Set<string>;
  limit: number;
}

async function fetchUserSignalProducts({
  admin,
  cats,
  userId,
  wishlistByCategory,
  briefTags,
  roomFilter,
  excludeIds,
  limit,
}: FetchUserSignalOptions): Promise<ProductRow[]> {
  if (limit <= 0) return [];
  if (!userId && briefTags.length === 0) return [];

  const out: ProductRow[] = [];

  // (a) Wishlist intersect category — strongest personal signal.
  if (userId) {
    for (const c of cats) {
      const bucket = wishlistByCategory.byCategory.get(c);
      if (!bucket) continue;
      for (const p of bucket) {
        if (excludeIds.has(p.id)) continue;
        excludeIds.add(p.id);
        out.push(p);
        if (out.length >= limit) return out;
      }
    }
  }

  // (b) Prefs-vision ranker. Pull a wider pool from the catalogue
  // (~5× limit) so the ranker has options to filter. Threshold on
  // image_url so we only surface visible products, and exclude
  // anything already collected. roomFilter biases toward
  // contextually-appropriate products even without palette match.
  if (briefTags.length > 0 && out.length < limit) {
    const need = limit - out.length;
    const pool = await admin
      .from('products')
      .select(SELECT_COLS_WITH_VP)
      .in('category', cats)
      .not('image_url', 'is', null)
      .overlaps('room_tags', roomFilter)
      .order('price_aud', { ascending: false, nullsFirst: false })
      .limit(Math.max(need * 5, 15));
    if (!pool.error && pool.data) {
      const candidates = (pool.data as ProductRowWithVP[]).filter(
        (p) => !excludeIds.has(p.id),
      );
      // rankCandidatesByPrefs handles the empty-vision_profile case
      // gracefully (neutral score). dropThreshold=-2 matches #156.
      const ranked = rankCandidatesByPrefs(candidates, briefTags).ranked;
      for (const p of ranked) {
        if (excludeIds.has(p.id)) continue;
        excludeIds.add(p.id);
        // Strip vision_profile back off when handing to the UI —
        // PickingMatch doesn't carry it and the bytes wasted on the
        // page payload would be meaningful.
        const { vision_profile: _vp, ...rest } = p;
        out.push(rest as ProductRow);
        if (out.length >= limit) break;
      }
    }
  }

  return out;
}

// Extended-set fetch for a single category. Used by the "See more"
// inline expansion (Phase 3, 2026-05-22) on /renders/[id]'s shop-by-
// category carousels — returns a longer set so the user can browse
// beyond the carousel's initial top picks without leaving the page.
//
// Same 3-tier filter as fetchCompleteTheLook (palette+room+style →
// palette+room → category+room). offset lets us skip the products
// already visible in the carousel; limit controls the depth of the
// extended set. Defaults: skip the first 8, return up to 24.
export interface FetchExtendedOptions {
  admin: SupabaseClient;
  /** displayLabel from the carousel (e.g. "Beds", "Side Tables").
   *  We expand it via CATEGORY_FAMILIES so the SQL matches the
   *  retailer-side variants the catalogue actually stores. */
  displayLabel: string;
  roomType: string | null;
  paletteId: string | null;
  styleTags?: string[];
  /** Skip this many results from the start. Caller passes the count
   *  of products already shown in the carousel so the extended set
   *  doesn't repeat them. Default 8. */
  offset?: number;
  /** Max products to return. Default 24. */
  limit?: number;
}

export async function fetchExtendedCategory({
  admin,
  displayLabel,
  roomType,
  paletteId,
  styleTags,
  offset = 8,
  limit = 24,
}: FetchExtendedOptions): Promise<PickingMatch[]> {
  const normalisedRoom = (roomType ?? '').toLowerCase().replace(/\s+/g, '_');
  const roomFilter = normalisedRoom ? [normalisedRoom, 'any'] : ['any'];
  const cats = expandCategory(displayLabel);
  const selectCols =
    'id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions';
  const from = offset;
  const to = offset + limit - 1;

  // Tier 1: palette + room + style.
  if (paletteId && styleTags && styleTags.length > 0) {
    const tier1 = await admin
      .from('products')
      .select(selectCols)
      .in('category', cats)
      .not('image_url', 'is', null)
      .contains('palette_tags', [paletteId])
      .overlaps('room_tags', roomFilter)
      .overlaps('style_tags', styleTags)
      .order('price_aud', { ascending: false, nullsFirst: false })
      .range(from, to);
    if (!tier1.error && tier1.data && tier1.data.length > 0) {
      return (tier1.data as ProductRow[]).map((p, i) => productRowToMatch(p, i));
    }
  }

  // Tier 2: palette + room.
  if (paletteId) {
    const tier2 = await admin
      .from('products')
      .select(selectCols)
      .in('category', cats)
      .not('image_url', 'is', null)
      .contains('palette_tags', [paletteId])
      .overlaps('room_tags', roomFilter)
      .order('price_aud', { ascending: false, nullsFirst: false })
      .range(from, to);
    if (!tier2.error && tier2.data && tier2.data.length > 0) {
      return (tier2.data as ProductRow[]).map((p, i) => productRowToMatch(p, i));
    }
  }

  // Tier 3: category + room only.
  const tier3 = await admin
    .from('products')
    .select(selectCols)
    .in('category', cats)
    .not('image_url', 'is', null)
    .overlaps('room_tags', roomFilter)
    .order('price_aud', { ascending: false, nullsFirst: false })
    .range(from, to);
  if (!tier3.error && tier3.data && tier3.data.length > 0) {
    return (tier3.data as ProductRow[]).map((p, i) => productRowToMatch(p, i));
  }

  return [];
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
