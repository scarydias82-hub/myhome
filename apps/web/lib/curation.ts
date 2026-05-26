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
  /** Sibling-link uuid for colour-variant grouping (PR #43). Same
   *  value across every colour/material variant of the same product;
   *  null when the product is standalone or the scraper didn't
   *  derive a group. The picker uses this to collapse sibling rows
   *  into a single card with colour swatches (A3). */
  variantGroupId: string | null;
  /** Display label for this specific variant ("Charcoal Linen",
   *  "Oat Bouclé"). Null when the product is standalone. */
  variantLabel: string | null;
  /** Cached dominant hex for the swatch dot (lifted from
   *  classifyProduct's dominant-colour extraction; PR #43). Null
   *  when colour wasn't extractable. */
  colourHex: string | null;
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
  /** Variant-grouping columns (PR #43). NULL on standalone products
   *  or rows where the backfill regex didn't match (most non-Coco
   *  rows today). */
  variant_group_id: string | null;
  variant_label: string | null;
  colour_hex: string | null;
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

// Categories that read as floor coverings — rugs, broadloom carpet,
// flooring rolls. The standard "doesn't dwarf the wall" rule (largest
// dim ≤ 75% shortest wall) was designed for furniture like sofas and
// beds; it makes no sense for floor coverings, which span the floor
// by design. A 240-300cm anchor rug for a 3m × 4m living room is
// exactly what the room calls for, but 240cm > (3m × 0.75 = 225cm)
// → the standard rule rejects almost every quality rug in that
// room. Owner reported "no rugs matching for the room with the black
// couches" — this is the bug.
//
// Tiles deliberately excluded — they're sold as individual ceramic
// units (60×60cm typical), not whole-floor coverings.
const FLOOR_COVERING_CATEGORIES = new Set([
  'Rugs',
  'Rug',
  'Carpet',
  'Carpets',
  'Flooring',
]);

// Build a predicate that returns true when a product's footprint fits
// the room. Two rules layered:
//
//   - Furniture (sofas, beds, tables, lighting, etc.) — largest
//     horizontal dimension ≤ 75% of the shortest room wall. 25%
//     breathing room for circulation + adjacent pieces. A 3.2m sofa
//     in a 3m bedroom is correctly rejected.
//
//   - Floor coverings (rugs, carpet, flooring per
//     FLOOR_COVERING_CATEGORIES) — longer side ≤ 95% of the longer
//     wall AND shorter side ≤ 95% of the shorter wall. The 95%
//     leaves a small floor-trim margin without rejecting standard
//     anchor-rug sizes. Lets a 280cm rug into a 3m room (it fits);
//     rejects a 380cm rug in the same room (it'd cover wall-to-wall).
//
// Tolerant by design: when EITHER side is missing data (room.width null,
// or product.dimensions null) the predicate returns true. We'd rather
// surface an unverifiable candidate than hide it.
function makeDimensionFilter(
  room: RoomDimensions | null | undefined,
): (dims: ProductRow['dimensions'], category: string) => boolean {
  if (!room) return () => true;
  const walls = [room.width_m, room.depth_m].filter(
    (m): m is number => typeof m === 'number' && m > 0,
  );
  if (walls.length === 0) return () => true;
  const shortestWallCm = Math.min(...walls) * 100;
  const longestWallCm = Math.max(...walls) * 100;
  const furnitureMaxCm = shortestWallCm * 0.75;
  const floorCoveringMaxCm = longestWallCm * 0.95;
  const floorCoveringMinCm = shortestWallCm * 0.95;
  return (dims, category) => {
    if (!dims) return true;
    const w = typeof dims.width_cm === 'number' ? dims.width_cm : 0;
    const d = typeof dims.depth_cm === 'number' ? dims.depth_cm : 0;
    const maxDim = Math.max(w, d);
    const minDim = Math.min(w, d);
    if (maxDim === 0) return true;
    if (FLOOR_COVERING_CATEGORIES.has(category)) {
      // Longer side fits along longer wall, shorter side along shorter
      // wall. If only one dimension is populated (minDim === 0 because
      // depth_cm was null), only constrain on the maxDim axis.
      const longOk = maxDim <= floorCoveringMaxCm;
      const shortOk = minDim === 0 || minDim <= floorCoveringMinCm;
      return longOk && shortOk;
    }
    return maxDim <= furnitureMaxCm;
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
      'products(id, name, retailer, category, price_aud, image_url, image_urls, product_url, affiliate_url, dimensions, variant_group_id, variant_label, colour_hex)',
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
      // Core columns guaranteed to exist on the products table from
      // the original 20260518000000_init_schema.sql migration. The
      // extended set below adds today's newer columns; if any of
      // those columns hasn't been applied to the live DB yet, the
      // whole select errors and the tier silently returns 0 rows
      // (silent empty-picker failure mode — bit us 2026-05-26).
      // We try extended first, fall back to core on error.
      const coreCols =
        'id, name, retailer, category, price_aud, image_url, image_urls, product_url, affiliate_url, dimensions';
      const extendedCols =
        coreCols + ', variant_group_id, variant_label, colour_hex';
      // Tier-runner: each tier passes a function that, given the
      // active column set, returns the awaited query result. On
      // schema-drift error (extended cols missing) it retries with
      // coreCols. Logs the error verbosely so we can see schema
      // drift in Vercel logs without the user repro-ing.
      type QueryResult = { data: unknown; error: { message: string } | null };
      const tryTier = async (
        tierLabel: string,
        // PostgrestFilterBuilder is a thenable but not strictly a
        // Promise; PromiseLike covers both shapes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        run: (cols: string) => PromiseLike<any>,
      ): Promise<ProductRow[]> => {
        const q: QueryResult = (await run(extendedCols)) as QueryResult;
        if (q.error) {
          console.warn(
            `[curation] "${displayLabel}" — ${tierLabel} extended select errored: ${q.error.message}. Retrying with core cols.`,
          );
          const q2: QueryResult = (await run(coreCols)) as QueryResult;
          if (q2.error) {
            console.error(
              `[curation] "${displayLabel}" — ${tierLabel} core select ALSO errored: ${q2.error.message}.`,
            );
            return [];
          }
          return (q2.data ?? []) as ProductRow[];
        }
        return (q.data ?? []) as ProductRow[];
      };

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
        const rows = await tryTier('Tier 1', (cols) => {
          let qb = admin.from('products').select(cols);
          if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
          return qb
            .in('category', cats)
            .not('image_url', 'is', null)
            .contains('palette_tags', [paletteId])
            .overlaps('room_tags', roomFilter)
            .overlaps('style_tags', styleTags)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(designerNeeded * 2);
        });
        designerRows.push(...rows);
      }
      if (paletteId && designerRows.length < designerNeeded) {
        const rows = await tryTier('Tier 2', (cols) => {
          let qb = admin.from('products').select(cols);
          if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
          return qb
            .in('category', cats)
            .not('image_url', 'is', null)
            .contains('palette_tags', [paletteId])
            .overlaps('room_tags', roomFilter)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(designerNeeded * 2);
        });
        designerRows.push(...rows);
      }
      if (designerRows.length < designerNeeded) {
        const rows = await tryTier('Tier 3', (cols) => {
          let qb = admin.from('products').select(cols);
          if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
          return qb
            .in('category', cats)
            .not('image_url', 'is', null)
            .overlaps('room_tags', roomFilter)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(designerNeeded * 2);
        });
        designerRows.push(...rows);
      }
      // Tier 4 — category only. Safety net mirroring the legacy
      // fallback in lib/matching.ts:fetchCandidates: if room_tags
      // taxonomy drift (or a vision slug we don't yet alias) leaves
      // tiers 1-3 empty, surface SOMETHING in the category so the
      // user is never stuck with an empty picker.
      const tier4StartCount = designerRows.length;
      if (designerRows.length < designerNeeded) {
        const rows = await tryTier('Tier 4', (cols) => {
          let qb = admin.from('products').select(cols);
          if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
          return qb
            .in('category', cats)
            .not('image_url', 'is', null)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(designerNeeded * 2);
        });
        designerRows.push(...rows);
      }
      // Tier 5 (2026-05-26) — if Tier 4 returned zero AND a retailer
      // allowlist is in play, retry once with the allowlist dropped.
      if (
        retailerAllowlist &&
        designerRows.length === tier4StartCount &&
        designerRows.length < designerNeeded
      ) {
        const rows = await tryTier('Tier 5', (cols) =>
          admin
            .from('products')
            .select(cols)
            .in('category', cats)
            .not('image_url', 'is', null)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(designerNeeded * 2),
        );
        if (rows.length > 0) {
          designerRows.push(...rows);
          console.log(
            `[curation] "${displayLabel}" — Tier 5: allowlist (${retailerAllowlist.join(',')}) had zero matches, surfaced ${rows.length} from any retailer`,
          );
        }
      }
      // Tier 7 (2026-05-26) — last-ditch fuzzy category match. If
      // Tiers 1-5 all returned zero, the most likely cause is that
      // the canonical category strings in `cats` don't match the
      // retailers' actual labels (e.g. picker expects 'Lighting'
      // but Coco stores 'Indoor Pendants'). Use a case-insensitive
      // LIKE match on the first ~3 cats as a noun. Drops retailer
      // allowlist too — better any product than empty.
      if (designerRows.length === 0) {
        const ilikePatterns = cats.slice(0, 3).map((c) => `%${c.toLowerCase()}%`);
        const orClause = ilikePatterns.map((p) => `category.ilike.${p}`).join(',');
        const rows = await tryTier('Tier 7', (cols) =>
          admin
            .from('products')
            .select(cols)
            .or(orClause)
            .not('image_url', 'is', null)
            .order('price_aud', { ascending: false, nullsFirst: false })
            .limit(perCategory * 2),
        );
        if (rows.length > 0) {
          designerRows.push(...rows);
          console.log(
            `[curation] "${displayLabel}" — Tier 7: fuzzy category match (${orClause}) surfaced ${rows.length} products. Canonical cats=[${cats.join(', ')}] returned zero — DB likely uses different category labels.`,
          );
        }
      }
      // Per-tier diagnostic — Vercel logs the count for each category
      // so the silent-empty-picker case (owner reported 2026-05-26
      // "no products available for the room") shows up in logs
      // without the user having to repro.
      console.log(
        `[curation] "${displayLabel}" — designerRows=${designerRows.length}, wishlist=${wishlistItems.length}, allowlist=${retailerAllowlist ? retailerAllowlist.join(',') : 'none'}, palette=${paletteId ?? 'none'}, room=${canonicalRoom ?? 'none'}`,
      );

      // 3. Merge wishlist-pinned + designer, dedupe by id, apply
      //    dimension filter, cap. Wishlist items deliberately bypass
      //    the dimension filter — the user explicitly chose them, so
      //    don't second-guess; if it doesn't fit, that's their call.
      const seen = new Set<string>(wishlistItems.map((r) => r.id));
      const merged: Array<{ row: ProductRow; isWishlisted: boolean }> = wishlistItems.map(
        (r) => ({ row: r, isWishlisted: true }),
      );
      let droppedByDim = 0;
      // Track filtered-out rows separately so we can fall back to
      // them when the dimension filter drops EVERYTHING (Tier 6 below).
      const dimensionRejects: ProductRow[] = [];
      for (const r of designerRows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (!dimensionFilter(r.dimensions, r.category)) {
          droppedByDim++;
          dimensionRejects.push(r);
          continue;
        }
        merged.push({ row: r, isWishlisted: false });
        if (merged.length >= perCategory) break;
      }
      // Tier 6 (2026-05-26) — dimension-filter escape hatch. If
      // designerRows had candidates but the dimension filter
      // dropped ALL of them (small room, oversized catalogue, or
      // a category where vision-extracted dims don't quite match
      // the AU sizing brackets), surface the rejects anyway. Better
      // to show the user products that are technically too big for
      // their room than show an empty category. They can choose to
      // ignore or re-measure.
      if (
        merged.length === wishlistItems.length &&
        designerRows.length > 0 &&
        dimensionRejects.length > 0
      ) {
        for (const r of dimensionRejects) {
          merged.push({ row: r, isWishlisted: false });
          if (merged.length >= perCategory) break;
        }
        console.log(
          `[curation] "${displayLabel}" — Tier 6: dimension filter dropped all ${droppedByDim} candidates; surfaced anyway (room ${roomDimensions?.width_m ?? '?'}m × ${roomDimensions?.depth_m ?? '?'}m). User sees products that may be oversized for their space.`,
        );
      }
      // Diagnostic: if the dimension filter is the reason a category
      // came back empty, log it so the silent-UX-failure case (owner
      // saw 0 rugs for the room with the black couches, 2026-05-26)
      // surfaces in Vercel function logs without the user having to
      // report it.
      if (droppedByDim > 0 && merged.length - wishlistItems.length === 0) {
        const dimsLog = roomDimensions
          ? `${roomDimensions.width_m ?? '?'}m × ${roomDimensions.depth_m ?? '?'}m`
          : 'no room dimensions';
        console.log(
          `[curation] "${displayLabel}" — dimension filter dropped all ${droppedByDim} candidates (room ${dimsLog}). Consider widening the filter for this category or relaxing room dims.`,
        );
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
          variantGroupId: row.variant_group_id,
          variantLabel: row.variant_label,
          colourHex: row.colour_hex,
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
