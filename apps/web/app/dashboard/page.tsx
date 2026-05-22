// Dashboard — products-first information architecture (Phase 1 of the
// strategic restack). Stack rank, top → bottom:
//
//   1. Top nav
//   2. Hero greeting + 4-tile quick actions
//   3. Featured products (Claude-curated weekly; heuristic placeholder
//      until #137 lands)
//   4. Trending products (7-day saves-velocity from shortlist_items)
//   5. Your active projects (compact horizontal strip)
//   6. Showpiece render (most recent succeeded render, full-bleed,
//      ready for hotspot overlay in Phase 3)
//   7. Design trends (3 carousels: palettes / 2026 / Tried & tested;
//      Shop is now the primary CTA on each card)
//   8. Vision boards (placeholder empty-state for Phase 1, real boards
//      land in Phase 2)
//   9. Nexus CTA
//  10. Footer
//
// Mobile-first throughout: tap targets ≥ 44px, snap-x carousels with
// peek-affordance, no hover-only states.
//
// Data fetches are parallel via Promise.all. The aggregate
// shortlist_items counts (featured + trending) require the admin
// client because the table is RLS'd to the owning user — we need
// cross-user counts for the social-proof hooks.

import { redirect } from 'next/navigation';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPalettes, paletteSwatch, paletteBrightness } from '@/lib/palettes';
import { TopNav } from '@/components/dashboard/top-nav';
import { HeroGreeting } from '@/components/dashboard/hero-greeting';
import { PreferencesSection } from '@/components/dashboard/sections/preferences-section';
import {
  ProjectsSection,
  type DashboardProjectCard,
} from '@/components/dashboard/sections/projects-section';
import {
  TrendsSection,
  type DashboardTrendCard,
  type DashboardPaletteCard,
} from '@/components/dashboard/sections/trends-section';
import {
  FeaturedProductsSection,
  type FeaturedProductCard,
} from '@/components/dashboard/sections/featured-products-section';
import {
  TrendingProductsSection,
  type TrendingProductCard,
} from '@/components/dashboard/sections/trending-products-section';
import {
  ShowpieceRenderSection,
  type ShowpieceRender,
  type ShowpieceHotspot,
} from '@/components/dashboard/sections/showpiece-render-section';
import {
  VisionBoardsSection,
  type VisionBoardCard,
} from '@/components/dashboard/sections/vision-boards-section';
import { NexusCTA } from '@/components/dashboard/sections/nexus-cta';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  pinterest_style_profile_id: string | null;
}

interface RenderRow {
  id: string;
  status: string;
  cost_estimate_aud: number | null;
  picking_list: unknown;
  image_url: string | null;
  prompt: string | null;
  created_at: string;
  project_id: string | null;
  style_slug: string | null;
}

interface RoomRow {
  id: string;
  analysis: unknown;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
  category: string;
  materials: string[] | null;
  style_tags: string[] | null;
}

interface TrendRow {
  id: string;
  palette_id: string;
  palette_name: string;
  room_type: string;
  headline: string;
  description: string;
  image_storage_key: string;
  source_signal: string | null;
}

interface ShortlistAggRow {
  product_id: string | null;
}

interface FeaturedRow {
  product_id: string;
  hook: string;
  position: number;
}

// Local mirror of the picking list shape from lib/matching.ts. We
// keep this isolated so the dashboard fetch doesn't have to import
// the full PickingListItem (which pulls in matching internals); only
// the fields we surface as hotspots matter here.
interface PickingListShape {
  itemLabel: string;
  category: string;
  bbox: { x: number; y: number; w: number; h: number };
  matches: Array<{
    productId: string;
    name: string;
    retailer: string;
    priceAud: number | null;
    imageUrl: string;
    productUrl: string;
    affiliateUrl?: string | null;
  }>;
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  // Prefer the explicit first_name on public.users; fall back to a
  // heuristic derived from the email prefix for accounts that haven't
  // had one captured yet. Same query also pulls the canonical
  // preferences blob (#153, §6.11 Phase A) — null when the user
  // hasn't onboarded yet, in which case PreferencesSection forces the
  // onboarding modal open on first dashboard load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from('users')
    .select('first_name, preferences')
    .eq('id', user.id)
    .maybeSingle();

  const emailPrefix = user.email?.split('@')[0] ?? 'there';
  const fallbackFirstName = capitalise(emailPrefix.split(/[._-]/)[0] ?? emailPrefix);
  const firstName = profile?.first_name?.trim() || fallbackFirstName;
  const initials = firstName.slice(0, 2).toUpperCase();
  const userPreferences = profile?.preferences ?? null;

  const admin = createAdminClient();
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? '';

  // Windows for the trending/featured aggregates. 7d trending matches
  // "what's hot this week"; 30d featured gives Phase 1 a stable set
  // that won't churn dramatically between visits.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel fetches. The admin shortlist aggregates use service-role
  // because shortlist_items is RLS'd to its owner.
  const [
    projectsRes,
    rendersRes,
    roomsRes,
    trendsRes,
    shortlists7dRes,
    shortlists30dRes,
    shortlistsLifetimeRes,
    latestRenderRes,
    visionBoardsRes,
    featuredRes,
    paletteLikesRes,
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, pinterest_style_profile_id')
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('renders')
      .select('id, status, cost_estimate_aud, picking_list, image_url, prompt, created_at, project_id, style_slug')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('rooms')
      .select('id, analysis')
      .not('analysis', 'is', null)
      .limit(1),
    supabase
      .from('trend_cards')
      .select(
        'id, palette_id, palette_name, room_type, headline, description, image_storage_key, source_signal',
      )
      .limit(200),
    // 7-day trending — count of product saves
    admin
      .from('shortlist_items')
      .select('product_id')
      .eq('kind', 'product')
      .gte('created_at', sevenDaysAgo)
      .not('product_id', 'is', null)
      .limit(1000),
    // 30-day featured — broader window for stable curation
    admin
      .from('shortlist_items')
      .select('product_id')
      .eq('kind', 'product')
      .gte('created_at', thirtyDaysAgo)
      .not('product_id', 'is', null)
      .limit(2000),
    // Lifetime — for tie-break when 7d/30d are zero (cold-start)
    admin
      .from('shortlist_items')
      .select('product_id')
      .eq('kind', 'product')
      .not('product_id', 'is', null)
      .limit(5000),
    // Most recent SUCCEEDED render for THIS user (showpiece). RLS-
    // filtered automatically.
    supabase
      .from('renders')
      .select('id, image_url, prompt, cost_estimate_aud, picking_list, created_at')
      .eq('status', 'succeeded')
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Vision boards — user's most recently-updated, max 8 on the
    // dashboard strip. The detail / index pages show the full set.
    supabase
      .from('vision_boards')
      .select('id, name, cover_image_url, item_count, updated_at')
      .order('updated_at', { ascending: false })
      .limit(8),
    // Weekly Claude-curated featured set (#137). When this is empty
    // (no recent cron run, or before the first run) we fall back to
    // the Phase 1 heuristic. Read via admin so users see the same
    // curated set regardless of their own RLS scope.
    admin
      .from('featured_products')
      .select('product_id, hook, position')
      .gt('featured_until', new Date().toISOString())
      .order('position', { ascending: true })
      .limit(12),
    // All palette likes — used to compose the palette carousel from
    // aggregate-popular + this user's liked palettes, sorted lightest
    // → darkest. Table is small at beta scale; read all rows in one go.
    // Cast through `any` — palette_likes not yet in generated types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('palette_likes')
      .select('user_id, palette_id')
      .limit(5000),
  ]);

  const projects = (projectsRes.data as ProjectRow[] | null) ?? [];
  const renders = (rendersRes.data as RenderRow[] | null) ?? [];
  const rooms = (roomsRes.data as RoomRow[] | null) ?? [];
  const trends = (trendsRes.data as TrendRow[] | null) ?? [];
  const saves7d = (shortlists7dRes.data as ShortlistAggRow[] | null) ?? [];
  const saves30d = (shortlistsLifetimeRes.data as ShortlistAggRow[] | null) ?? [];
  const savesLifetime = (shortlistsLifetimeRes.data as ShortlistAggRow[] | null) ?? [];
  const latestRender = latestRenderRes.data as
    | {
        id: string;
        image_url: string | null;
        prompt: string | null;
        cost_estimate_aud: number | null;
        picking_list: unknown;
        created_at: string;
      }
    | null;
  // Suppress unused-var warning — we keep saves30d in case Phase 4 hot-
  // swaps the featured heuristic in this file rather than via cron.
  void saves30d;
  void shortlists30dRes;

  // Build aggregate maps: product_id → count
  const count7d = aggregateCounts(saves7d);
  const countLifetime = aggregateCounts(savesLifetime);

  // Active curated featured set (#137). When present this preempts
  // the heuristic — Claude wrote a cohesive theme for the week,
  // we want to ship that as-is.
  const curatedFeatured = (featuredRes.data as FeaturedRow[] | null) ?? [];
  const curatedById = new Map(curatedFeatured.map((r) => [r.product_id, r]));

  // Hydrate the top-N product rows for featured + trending.
  // Trending = top 8 by 7d count (or lifetime if cold-start)
  // Featured = curated rows (Claude) if present, else top 8 by
  // lifetime among "quality" products (have image + style_tags).
  const trendingIds = pickTopN(count7d.size > 0 ? count7d : countLifetime, 8);
  const featuredIds =
    curatedFeatured.length > 0
      ? curatedFeatured.map((r) => r.product_id)
      : pickTopN(countLifetime, 8, trendingIds);

  // Fetch the product detail rows for both sets. Use a single query
  // unioning all needed IDs; we'll split downstream.
  const allProductIds = Array.from(new Set([...trendingIds, ...featuredIds]));
  let allProducts: ProductRow[] = [];
  if (allProductIds.length > 0) {
    const res = await admin
      .from('products')
      .select(
        'id, name, retailer, price_aud, image_url, product_url, affiliate_url, category, materials, style_tags',
      )
      .in('id', allProductIds);
    allProducts = (res.data as ProductRow[] | null) ?? [];
  }

  // If we have NO save signal yet (fresh deployment with no
  // shortlist activity), fall back to the most-recently-added
  // catalogue products as the featured set so the carousel never
  // ships empty. Trending stays empty in that case (the hook copy
  // covers "Trending" when 7d is zero anyway).
  if (allProducts.length === 0) {
    const fallback = await admin
      .from('products')
      .select(
        'id, name, retailer, price_aud, image_url, product_url, affiliate_url, category, materials, style_tags',
      )
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(8);
    allProducts = (fallback.data as ProductRow[] | null) ?? [];
  }

  const productsById = new Map(allProducts.map((p) => [p.id, p]));

  // Map palette_id → palette object (used for project cards + trend
  // bucket assignment).
  const palettesById = new Map(listPalettes().map((p) => [p.id, p]));

  // --- Palette carousel composition -----------------------------------------
  // "Popular" = palettes sorted by aggregate like count (all users).
  // "Your palettes" = palettes this user has liked.
  // Carousel = union(popular top-18 + user-liked), ordered lightest → darkest.
  // Cold-start fallback: when the palette_likes table is empty we seed
  // "popular" from the editorial `popular` tag so the carousel is never blank.

  type PaletteLikeRow = { user_id: string; palette_id: string };
  const allLikes = (paletteLikesRes.data as PaletteLikeRow[] | null) ?? [];

  const likeCountMap = new Map<string, number>();
  for (const row of allLikes) {
    likeCountMap.set(row.palette_id, (likeCountMap.get(row.palette_id) ?? 0) + 1);
  }
  const userLikedPaletteIds = new Set(
    allLikes.filter((l) => l.user_id === user.id).map((l) => l.palette_id),
  );

  // Top 18 most-liked globally — or editorial popular as the cold-start seed.
  const sortedPopularIds: string[] =
    likeCountMap.size > 0
      ? [...likeCountMap.entries()]
          .sort(([, a], [, b]) => b - a)
          .slice(0, 18)
          .map(([id]) => id)
      : listPalettes()
          .filter((p) => p.tags.includes('popular'))
          .map((p) => p.id);

  const carouselPaletteIds = new Set([...sortedPopularIds, ...userLikedPaletteIds]);
  const carouselPalettes = listPalettes()
    .filter((p) => carouselPaletteIds.has(p.id))
    // Lightest → darkest: higher perceptual luminance first.
    .sort((a, b) => paletteBrightness(b) - paletteBrightness(a));
  // --------------------------------------------------------------------------

  // Project cards (existing logic, untouched)
  const projectCards: DashboardProjectCard[] = projects.map((p) => {
    const projectRenders = renders.filter((r) => r.project_id === p.id);
    const itemCount = projectRenders.reduce((sum, r) => {
      const list = (r.picking_list as unknown[] | null) ?? [];
      return sum + list.length;
    }, 0);
    const budget = projectRenders.reduce((sum, r) => sum + (r.cost_estimate_aud ?? 0), 0);
    const status: DashboardProjectCard['status'] = mapProjectStatus(p.status, projectRenders);
    return {
      id: p.id,
      name: p.name,
      roomType: null,
      status,
      paletteHexes: paletteHexesFor(p.pinterest_style_profile_id, palettesById),
      progress: progressFor(status, projectRenders.length),
      itemCount,
      budgetAud: budget > 0 ? budget : null,
    };
  });

  // Trend cards — dedupe by palette_id (one card per palette,
  // selected from the user's most-recently-analysed room when
  // possible).
  const preferredRoom =
    rooms[0]?.analysis &&
    typeof rooms[0].analysis === 'object' &&
    'room_type' in (rooms[0].analysis as Record<string, unknown>)
      ? ((rooms[0].analysis as { room_type?: string | null }).room_type ?? null)
      : null;

  const trendsByPalette = new Map<string, TrendRow>();
  for (const t of trends) {
    const existing = trendsByPalette.get(t.palette_id);
    if (!existing) {
      trendsByPalette.set(t.palette_id, t);
      continue;
    }
    if (preferredRoom && t.room_type === preferredRoom && existing.room_type !== preferredRoom) {
      trendsByPalette.set(t.palette_id, t);
    } else if (
      existing.room_type !== preferredRoom &&
      t.room_type === 'living_room' &&
      existing.room_type !== 'living_room'
    ) {
      trendsByPalette.set(t.palette_id, t);
    }
  }

  const trendCards: DashboardTrendCard[] = Array.from(trendsByPalette.values()).map((t) => {
    const palette = palettesById.get(t.palette_id);
    return {
      id: t.id,
      headline: t.headline,
      paletteName: t.palette_name,
      paletteHexes: palette ? palette.colors.map((c) => c.hex) : [],
      roomType: t.room_type,
      season: t.source_signal ?? '2026',
      description: t.description,
      matchNote: null,
      imageUrl: `${supabaseUrl}/storage/v1/object/public/trends/${t.image_storage_key}`,
      paletteId: t.palette_id,
      timelessness: palette?.timelessness ?? 5,
    };
  });

  // Featured product cards. Each one carries a provenance hook
  // explaining why it's there. Phase 1 hook palette:
  //   • saved by ≥ 5 users         → "Top community pick"
  //   • style_tags has "luxe"      → "Editor's pick"
  //   • else                       → "Featured this week"
  const featuredCards: FeaturedProductCard[] = featuredIds
    .map((id) => productsById.get(id))
    .filter((p): p is ProductRow => Boolean(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      retailer: p.retailer,
      category: p.category,
      priceAud: p.price_aud,
      imageUrl: p.image_url,
      productUrl: p.affiliate_url ?? p.product_url,
      // Curated rows carry a Claude-written hook tied to the theme.
      // Heuristic fallback computes a hook from save counts +
      // style_tags signals.
      hook: curatedById.get(p.id)?.hook ?? hookForFeatured(p, countLifetime.get(p.id) ?? 0),
      styleTags: (p.style_tags ?? []).slice(0, 2),
    }));

  // If we got no featured from the heuristic but did get fallback
  // rows, surface them with a neutral "New this week" hook so the
  // carousel still ships content.
  if (featuredCards.length === 0 && allProducts.length > 0) {
    for (const p of allProducts.slice(0, 8)) {
      featuredCards.push({
        id: p.id,
        name: p.name,
        retailer: p.retailer,
        category: p.category,
        priceAud: p.price_aud,
        imageUrl: p.image_url,
        productUrl: p.affiliate_url ?? p.product_url,
        hook: 'New this week',
        styleTags: (p.style_tags ?? []).slice(0, 2),
      });
    }
  }

  // Trending product cards
  const trendingCards: TrendingProductCard[] = trendingIds
    .map((id) => productsById.get(id))
    .filter((p): p is ProductRow => Boolean(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      retailer: p.retailer,
      category: p.category,
      priceAud: p.price_aud,
      imageUrl: p.image_url,
      productUrl: p.affiliate_url ?? p.product_url,
      saves7d: count7d.get(p.id) ?? 0,
      savesLifetime: countLifetime.get(p.id) ?? 0,
      styleTags: (p.style_tags ?? []).slice(0, 2),
    }));

  // Showpiece render — most recent succeeded render for this user.
  // The picking_list and palette hex resolution drives the metadata
  // band underneath the image, AND the hotspot overlay (#136).
  let showpiece: ShowpieceRender | null = null;
  let showpieceHotspots: ShowpieceHotspot[] = [];
  if (latestRender && latestRender.image_url) {
    const list = (latestRender.picking_list as PickingListShape[] | null) ?? [];
    // Resolve palette hexes from the originating project (if any)
    const showpiecePalette = renders.find((r) => r.id === latestRender.id);
    const paletteRef = showpiecePalette
      ? (projects.find((pr) => pr.id === showpiecePalette.project_id)
          ?.pinterest_style_profile_id ?? null)
      : null;
    showpiece = {
      id: latestRender.id,
      imageUrl: latestRender.image_url,
      prompt: latestRender.prompt,
      paletteHexes: paletteHexesFor(paletteRef, palettesById),
      itemCount: list.length,
      budgetAud: latestRender.cost_estimate_aud,
      createdAt: latestRender.created_at,
    };
    // Derive hotspots from the picking list — each item's bbox +
    // top match becomes a tap-to-reveal dot on the render image.
    showpieceHotspots = list
      .filter((it) => it && it.bbox && it.matches && it.matches.length > 0)
      .map((it) => {
        const top = it.matches[0];
        return {
          itemLabel: it.itemLabel,
          category: it.category,
          bbox: it.bbox,
          match: top
            ? {
                productId: top.productId,
                name: top.name,
                retailer: top.retailer,
                priceAud: top.priceAud,
                imageUrl: top.imageUrl,
                productUrl: top.affiliateUrl ?? top.productUrl,
              }
            : null,
        };
      });
  }

  // Vision boards — real data via the new Phase 2 schema (#135).
  // Thumbnails are not populated here; the section's empty-cover
  // fallback uses the cover_image_url first, then falls back to an
  // "Empty board" placeholder. Derived item thumbnails (first
  // 4 product/trend images per board) is a Phase 3 enhancement.
  const visionBoards: VisionBoardCard[] = (
    (visionBoardsRes.data as
      | { id: string; name: string; cover_image_url: string | null; item_count: number; updated_at: string }[]
      | null) ?? []
  ).map((b) => ({
    id: b.id,
    name: b.name,
    itemCount: b.item_count,
    coverImageUrl: b.cover_image_url,
    itemThumbnails: [],
    updatedAt: b.updated_at,
  }));

  // Nexus pipeline state — kept from the previous dashboard so the
  // CTA still reflects the user's progress.
  const hasRender = renders.some((r) => r.status === 'succeeded');
  const hasMatches = renders.some((r) => {
    const list = (r.picking_list as unknown[] | null) ?? [];
    return list.length > 0;
  });
  const nexusSteps = {
    inspiration: 'active',
    siteAnalysed: rooms.length > 0 ? 'done' : 'active',
    productsMatched: hasMatches ? 'done' : hasRender ? 'active' : 'future',
    rendered: hasRender ? 'done' : 'future',
    shopped: hasMatches && hasRender ? 'active' : 'future',
  } as const;

  const activeProject = projectCards[0]
    ? { id: projectCards[0].id, name: projectCards[0].name }
    : null;

  return (
    <div className="min-h-screen bg-editorial-cream font-dmsans text-editorial-ink">
      <TopNav initials={initials} fullName={firstName} />
      <main className="mx-auto max-w-[1200px] px-4 md:px-6">
        {/* 1. Hero + quick actions — compact on mobile so featured
            products land above the fold once the user scrolls a
            single thumb-length. */}
        <HeroGreeting firstName={firstName} />

        {/* 1.5. My Preferences — canonical user-level taste signal
            (§6.11 Phase A, #153). Placement A: visible dedicated
            section right under the greeting so it's the first thing
            a user sees after their name. Renders the onboarding
            modal automatically on first dashboard load when
            preferences is null. */}
        <div className="mt-6">
          <PreferencesSection preferences={userPreferences} />
        </div>

        {/* 2. Featured products — Claude-curated weekly (heuristic
            until #137). Sits above all other content so products
            are the first thing a returning user engages with. */}
        <FeaturedProductsSection products={featuredCards} />

        {/* 3. Trending products — 7-day saves-velocity. Social proof
            + sale-pressure copy. */}
        <TrendingProductsSection products={trendingCards} />

        {/* 4. Active projects — compact strip. Hidden entirely when
            zero (the quick-actions tile up top covers it). */}
        <ProjectsSection projects={projectCards} />

        {/* 5. Showpiece render — most recent succeeded render at
            full bleed. Empty-state surfaces a sample so the section
            never reads blank. Phase 3 layers hotspot dots on top. */}
        <ShowpieceRenderSection
          render={showpiece}
          hotspots={showpieceHotspots}
          demoImageUrl="https://v3.fal.media/files/penguin/3kbcoR4cyqUaXuk_BJryT_image.webp"
        />

        {/* 6. Design trends — kept (3 carousels: palettes / 2026 /
            T&T) but the per-card CTAs are now "Shop this trend"
            primary, "Render it" secondary. */}
        <TrendsSection
          trends={trendCards}
          palettes={carouselPalettes.map<DashboardPaletteCard>((p) => ({
            id: p.id,
            name: p.name,
            vibe: p.vibe,
            trendSource: p.trend_source,
            swatchHexes: paletteSwatch(p),
            timelessness: p.timelessness,
            personaFit: p.persona_fit,
            recommendedRooms: p.recommended_rooms,
            tags: p.tags,
            likeCount: likeCountMap.get(p.id) ?? 0,
            likedByUser: userLikedPaletteIds.has(p.id),
          }))}
        />

        {/* 7. Vision boards — empty-state for now; Phase 2 fills it. */}
        <VisionBoardsSection boards={visionBoards} />

        {/* 8. Nexus CTA — pipeline progress reminder. */}
        <NexusCTA steps={nexusSteps} activeProject={activeProject} />

        <footer className="mt-8 border-t border-editorial-border pt-6 pb-12 text-center">
          <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
            myMaison · your personal design studio · Australia
          </p>
        </footer>
      </main>
    </div>
  );
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function mapProjectStatus(
  raw: string,
  renderCount: RenderRow[],
): DashboardProjectCard['status'] {
  if (raw === 'completed') return 'shopping';
  if (renderCount.length > 0) return 'in_progress';
  return 'planning';
}

function paletteHexesFor(
  styleProfileId: string | null,
  palettes: Map<string, ReturnType<typeof listPalettes>[number]>,
): string[] {
  void styleProfileId;
  const fallback = palettes.get('warm-grounded-earth');
  return fallback ? fallback.colors.slice(0, 5).map((c) => c.hex) : [];
}

function progressFor(status: DashboardProjectCard['status'], renderCount: number): number {
  if (status === 'shopping') return 90;
  if (status === 'in_progress') return Math.min(85, 30 + renderCount * 15);
  return 15;
}

// Aggregate counts from a flat array of {product_id} rows.
function aggregateCounts(rows: ShortlistAggRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.product_id) continue;
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + 1);
  }
  return m;
}

// Pick top-N product_ids by count, excluding any in the `exclude`
// list. Stable order — ties broken by insertion order.
function pickTopN(counts: Map<string, number>, n: number, exclude: string[] = []): string[] {
  const excludeSet = new Set(exclude);
  return Array.from(counts.entries())
    .filter(([id]) => !excludeSet.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

// Hook copy for the featured carousel — three tiers, picked so the
// editorial voice stays consistent even when the heuristic doesn't
// have a strong signal.
function hookForFeatured(p: ProductRow, lifetimeSaves: number): string {
  if (lifetimeSaves >= 5) return 'Top community pick';
  const tags = (p.style_tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => t.includes('luxe') || t.includes('heritage') || t.includes('premium'))) {
    return "Editor's pick";
  }
  if (lifetimeSaves > 0) return 'Saved by our community';
  return 'Featured this week';
}
