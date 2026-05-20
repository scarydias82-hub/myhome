import { redirect } from 'next/navigation';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPalettes } from '@/lib/palettes';
import { TopNav } from '@/components/dashboard/top-nav';
import { HeroGreeting } from '@/components/dashboard/hero-greeting';
import { PinterestSection } from '@/components/dashboard/sections/pinterest-section';
import {
  ProjectsSection,
  type DashboardProjectCard,
} from '@/components/dashboard/sections/projects-section';
import {
  ARSection,
  type ARProductCard,
} from '@/components/dashboard/sections/ar-section';
import {
  TrendsSection,
  type DashboardTrendCard,
  type DashboardPaletteCard,
} from '@/components/dashboard/sections/trends-section';
import { paletteSwatch } from '@/lib/palettes';
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
  created_at: string;
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

export default async function DashboardPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const emailPrefix = user.email?.split('@')[0] ?? 'there';
  const firstName = capitalise(emailPrefix.split(/[._-]/)[0] ?? emailPrefix);
  const initials = firstName.slice(0, 2).toUpperCase();

  const [projectsRes, rendersRes, roomsRes, pinterestRes, trendsRes, productsRes] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id, name, status, pinterest_style_profile_id')
        .order('updated_at', { ascending: false })
        .limit(6),
      supabase
        .from('renders')
        .select('id, status, cost_estimate_aud, picking_list, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('rooms')
        .select('id, analysis')
        .not('analysis', 'is', null)
        .limit(1),
      supabase
        .from('pinterest_connections')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('trend_cards')
        .select(
          'id, palette_id, palette_name, room_type, headline, description, image_storage_key, source_signal',
        )
        // Fetch the full set so the dashboard can show one card per
        // palette (16 palettes × 6 room types = 96 rows max). Previous
        // .limit(6) starved both carousels — 3 trend-forward + 3
        // timeless visible. Dedup-by-palette below picks the best
        // room-variant per palette so we get one card per palette
        // across the carousels.
        .limit(200),
      supabase
        .from('products')
        .select(
          'id, name, retailer, price_aud, image_url, product_url, affiliate_url, category, materials',
        )
        .not('image_url', 'is', null)
        .order('price_aud', { ascending: false, nullsFirst: false })
        .limit(6),
    ]);

  const projects = (projectsRes.data as ProjectRow[] | null) ?? [];
  const renders = (rendersRes.data as RenderRow[] | null) ?? [];
  const rooms = (roomsRes.data as RoomRow[] | null) ?? [];
  const trends = (trendsRes.data as TrendRow[] | null) ?? [];
  const products = (productsRes.data as ProductRow[] | null) ?? [];
  const pinterestConnected = Boolean(pinterestRes.data);

  // Map palette_id → hex array (for project + trend cards)
  const palettesById = new Map(listPalettes().map((p) => [p.id, p]));

  // Project cards — wrap real DB data into the dashboard shape
  const projectCards: DashboardProjectCard[] = projects.map((p) => {
    const projectRenders = renders.filter(
      (r) => (r as unknown as { project_id?: string }).project_id === p.id,
    );
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

  // Trend cards — dedupe by palette_id so every palette gets exactly
  // one card on the dashboard (16 palettes × 6 rooms = up to 96 rows
  // from the table; we want one card per palette across the carousels).
  // Preference order for the room variant we pick per palette:
  //   1. Match the user's most recently analysed room
  //   2. Fall back to 'living_room' which has the widest coverage
  //   3. First card in the result set for that palette
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const preferredRoom = rooms[0]?.analysis &&
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
    // Prefer the user's room over the existing pick; prefer
    // living_room over arbitrary fallbacks.
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
      matchNote: pinterestConnected ? 'Matches your saved boards' : null,
      imageUrl: `${supabaseUrl}/storage/v1/object/public/trends/${t.image_storage_key}`,
      paletteId: t.palette_id,
      // Persona metadata threaded so TrendsSection can bucket cards
      // into the 2026 vs Tried & Tested carousels. Falls back to 5
      // (neutral) when the palette lookup misses.
      timelessness: palette?.timelessness ?? 5,
    };
  });

  // AR product cards
  const arProducts: ARProductCard[] = products.map((p, i) => ({
    id: p.id,
    name: p.name,
    retailer: p.retailer,
    priceAud: p.price_aud,
    imageUrl: p.image_url,
    productUrl: p.product_url,
    affiliateUrl: p.affiliate_url,
    // Stub compatibility — proper version comes from the matching pipeline
    // ranking against the user's active palette. We seed with a sane range
    // so the bars don't all read identical.
    compatibility: 78 + ((i * 13) % 18),
    styleTags: (p.materials ?? []).slice(0, 2),
    category: p.category,
  }));

  // Nexus pipeline state
  const hasRender = renders.some((r) => r.status === 'succeeded');
  const hasMatches = renders.some((r) => {
    const list = (r.picking_list as unknown[] | null) ?? [];
    return list.length > 0;
  });
  const nexusSteps = {
    inspiration: pinterestConnected ? 'done' : 'active',
    siteAnalysed: rooms.length > 0 ? 'done' : pinterestConnected ? 'active' : 'future',
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
      <main className="mx-auto max-w-[1200px] px-6">
        <HeroGreeting firstName={firstName} />

        <PinterestSection
          connected={pinterestConnected}
          boards={[
            /* placeholders shown only when connected — Phase 2 will populate */
          ]}
        />

        <ProjectsSection projects={projectCards} />

        {/* Trends section — three carousels:
              ① Colour palettes (the pure 16-palette swatch view)
              ② 2026 trends (palette × room visuals, trend-forward)
              ③ Tried & tested (palette × room visuals, timeless)
            Always renders the palette carousel; the trend-card carousels
            only render when trend_cards rows exist. */}
        <TrendsSection
          trends={trendCards}
          palettes={Array.from(palettesById.values()).map<DashboardPaletteCard>((p) => ({
            id: p.id,
            name: p.name,
            vibe: p.vibe,
            trendSource: p.trend_source,
            swatchHexes: paletteSwatch(p),
            timelessness: p.timelessness,
            personaFit: p.persona_fit,
            recommendedRooms: p.recommended_rooms,
          }))}
        />

        <ARSection products={arProducts} />

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
  // For now we don't link projects to a specific palette id (style_profiles
  // table uses a different source_ref scheme). Fall back to a sensible
  // default palette so cards don't render bare.
  void styleProfileId;
  const fallback = palettes.get('warm-grounded-earth');
  return fallback ? fallback.colors.slice(0, 5).map((c) => c.hex) : [];
}

function progressFor(status: DashboardProjectCard['status'], renderCount: number): number {
  if (status === 'shopping') return 90;
  if (status === 'in_progress') return Math.min(85, 30 + renderCount * 15);
  return 15;
}
