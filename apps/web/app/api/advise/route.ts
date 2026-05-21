// POST /api/advise — designer LLM advice for a specific render.
//
// Body: { renderId: string, paletteId?: string }
// Returns: { advice: DesignerAdvice } — see lib/designer.ts.
//
// Behaviour:
//   - Idempotent: if renders.designer_read is already populated for the
//     requested renderId, return it without recomputing.
//   - Otherwise runs the designer LLM, persists the result to
//     renders.designer_read (best-effort — tolerates missing column if
//     the 20260520100000 migration hasn't been applied yet), and
//     returns the advice.
//   - Side effect: caches the room's vision analysis on rooms.analysis
//     the first time we see it.
//
// This endpoint is the client-side fallback for the optimistic
// designer pre-read that /api/render kicks off via after(). Either
// path can populate designer_read — the client just keeps refetching
// from /api/advise until it does.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPalette, listPalettes, type Palette } from '@/lib/palettes';
import { analyseRoom, type RoomAnalysis, type VisionMediaType } from '@/lib/vision';
import { getDesignerAdvice } from '@/lib/designer';
import type { DesignerAdvice } from '@/components/renders/designer-read';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  renderId?: string;
  paletteId?: string;
}

interface RenderRow {
  id: string;
  user_id: string;
  room_id: string;
  style_profile_id: string | null;
}

interface StyleProfileRow {
  palette: string[] | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const renderId = body.renderId;
  if (!renderId || typeof renderId !== 'string') {
    return NextResponse.json({ error: 'Missing renderId' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Look up the render → room (owner check enforced via the render row).
  const renderRes = await admin
    .from('renders')
    .select('id, user_id, room_id, style_profile_id')
    .eq('id', renderId)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  // IDEMPOTENCY — if the designer_read column exists AND already has a
  // value for this render, return it. Saves a Claude call when the
  // client retries after the after() block has already populated it.
  // The maybeSingle + defensive read pattern tolerates the
  // 20260520100000 migration not having been applied yet.
  const existingRes = await admin
    .from('renders')
    .select('designer_read')
    .eq('id', renderId)
    .maybeSingle();
  if (!existingRes.error && existingRes.data) {
    const existing = (existingRes.data as { designer_read: DesignerAdvice | null }).designer_read;
    if (existing && typeof existing === 'object') {
      return NextResponse.json({ advice: existing, cached: true });
    }
  }

  // Resolve a palette. Three precedence levels:
  //   1. body.paletteId from the legacy palette picker (kept for ad-hoc reruns)
  //   2. Inferred from the render's style_profile.palette hex array by
  //      matching against known palettes
  //   3. null — lets the designer LLM infer one from the room analysis
  let palette: Palette | null = body.paletteId ? getPalette(body.paletteId) ?? null : null;
  if (!palette && render.style_profile_id) {
    const profileRes = await admin
      .from('style_profiles')
      .select('palette')
      .eq('id', render.style_profile_id)
      .single();
    const profile = profileRes.data as StyleProfileRow | null;
    palette = matchPaletteByHex(profile?.palette ?? null);
  }

  // Pull room photo + cached analysis. Analyse if not cached.
  const roomRes = await admin
    .from('rooms')
    .select('id, photo_url, analysis')
    .eq('id', render.room_id)
    .single();
  const room = roomRes.data as
    | { id: string; photo_url: string; analysis: RoomAnalysis | null }
    | null;
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  let roomAnalysis = room.analysis;
  if (!roomAnalysis) {
    // Download the photo bytes and pass inline to analyseRoom (base64)
    // — avoids an Anthropic server-side URL fetch (~1-2s).
    const dl = await admin.storage.from('rooms').download(room.photo_url);
    if (dl.error || !dl.data) {
      return NextResponse.json({ error: 'Could not load room photo.' }, { status: 500 });
    }
    const buffer = Buffer.from(await dl.data.arrayBuffer());
    const mediaType = (dl.data.type || 'image/jpeg') as VisionMediaType;
    try {
      roomAnalysis = await analyseRoom({ buffer, mediaType });
      await admin.from('rooms').update({ analysis: roomAnalysis }).eq('id', room.id);
    } catch (err) {
      console.error('vision analysis failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Room analysis failed.' },
        { status: 500 },
      );
    }
  }

  try {
    const advice = await getDesignerAdvice({ admin, roomAnalysis, palette });

    // PERSIST — best-effort write to renders.designer_read so the next
    // page load + any future /api/advise call short-circuits via the
    // idempotency check above. Wrapped in try/catch because the
    // designer_read column might not exist yet (pre-migration).
    try {
      const updateRes = await admin
        .from('renders')
        .update({ designer_read: advice })
        .eq('id', renderId);
      if (updateRes.error) {
        console.warn(
          '[advise] could not persist designer_read (migration may not have run)',
          updateRes.error.message,
        );
      }
    } catch (err) {
      console.warn('[advise] designer_read update failed', err);
    }

    return NextResponse.json({ advice, cached: false });
  } catch (err) {
    console.error('designer advice failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Designer advice failed.' },
      { status: 500 },
    );
  }
}

// Heuristic: match the style_profile's hex array back to a known
// palette by counting overlapping hex codes. If at least 3 hex codes
// match a palette's swatches, that's our palette. Otherwise return
// null and let the designer LLM infer one.
function matchPaletteByHex(hexes: string[] | null): Palette | null {
  if (!hexes || hexes.length === 0) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  const target = new Set(hexes.map(norm));
  let best: { palette: Palette; matches: number } | null = null;
  for (const p of listPalettes()) {
    const swatch = p.colors.map((c) => norm(c.hex));
    const matches = swatch.filter((h) => target.has(h)).length;
    if (matches >= 3 && (!best || matches > best.matches)) {
      best = { palette: p, matches };
    }
  }
  return best?.palette ?? null;
}
