// GET /api/renders/[id]/extended/[category]
//
// Phase 3 of the 2026-05-22 render-page IA rework: powers the
// inline "See more" expansion on each shop-by-category carousel.
// Looks up the render's palette + room, runs the same 3-tier
// filter fetchCompleteTheLook uses, but returns a deeper slice
// (skip the first N products already in the carousel, return up
// to M extras) so the user can browse beyond the initial picks
// without leaving the page.
//
// Path:
//   [id]        — render UUID
//   [category]  — URL-encoded displayLabel (e.g. "Beds",
//                 "Side%20Tables"). NOT a slug — we round-trip the
//                 displayLabel so the same CATEGORY_FAMILIES
//                 expansion that drives the carousel applies.
//
// Query params:
//   offset      — products to skip. Defaults to 8 (the carousel
//                 default). Pass the actual carousel length when
//                 it differs.
//   limit       — max products to return. Defaults to 24. Clamped
//                 at 60 server-side as a safety.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchExtendedCategory } from '@/lib/completeTheLook';
import { findPaletteByHexes, getPalette } from '@/lib/palettes';
import { getStyle } from '@/lib/styles';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_LIMIT = 60;

interface RenderRow {
  id: string;
  user_id: string;
  style_profile_id: string | null;
  room_id: string | null;
}

interface ProfileRow {
  palette: string[] | null;
  source_ref: string | null;
}

interface RoomRow {
  analysis: { room_type?: string | null } | null;
  room_type: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; category: string }> },
) {
  const { id, category } = await context.params;
  const decodedCategory = decodeURIComponent(category);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const renderRes = await admin
    .from('renders')
    .select('id, user_id, style_profile_id, room_id')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  // Resolve palette + style + room from the render row. Same path the
  // /status route uses to seed buildPickingList — we want the extended
  // set filtered identically to the carousel that opened it.
  let paletteId: string | null = null;
  let styleTags: string[] = [];
  if (render.style_profile_id) {
    const profileRes = await admin
      .from('style_profiles')
      .select('palette, source_ref')
      .eq('id', render.style_profile_id)
      .single();
    const profile = profileRes.data as ProfileRow | null;
    if (profile) {
      const palette = findPaletteByHexes(profile.palette ?? null);
      paletteId = palette?.id ?? null;
      if (profile.source_ref) {
        const style = getStyle(profile.source_ref);
        if (style) {
          // Same style-tags shape the page uses for fetchCompleteTheLook
          // — mood tags + the style slug itself.
          styleTags = [...(style.mood ?? []), profile.source_ref];
        }
      }
      // Defensive: ensure paletteId is set if we have the hexes but no
      // direct match (palette hexes can drift from palettes.json).
      if (!paletteId && profile.palette) {
        const directLookup = getPalette(profile.palette.join(','));
        if (directLookup) paletteId = directLookup.id;
      }
    }
  }

  let roomType: string | null = null;
  if (render.room_id) {
    const roomRes = await admin
      .from('rooms')
      .select('analysis, room_type')
      .eq('id', render.room_id)
      .single();
    const room = roomRes.data as RoomRow | null;
    roomType = room?.analysis?.room_type ?? room?.room_type ?? null;
  }

  const url = new URL(request.url);
  const offsetParam = Number(url.searchParams.get('offset'));
  const limitParam = Number(url.searchParams.get('limit'));
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? Math.floor(offsetParam) : 8;
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(MAX_LIMIT, Math.floor(limitParam))
    : 24;

  const products = await fetchExtendedCategory({
    admin,
    displayLabel: decodedCategory,
    roomType,
    paletteId,
    styleTags,
    offset,
    limit,
  });

  return NextResponse.json({
    category: decodedCategory,
    offset,
    limit,
    products,
  });
}
