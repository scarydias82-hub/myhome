// POST /api/recommend
//
// Stage 2 of the photo flow (#143). Runs the brief synthesiser
// against an already-cached room analysis (from /api/analyse-room)
// plus any brief tags from the project. Returns a palette + style
// pick + reasoning that the upload form pre-selects in the
// carousels.
//
// Split from /api/analyse-room so the UI can stage two distinct
// loading overlays:
//   Phase 1 — vision overlay on the photo:
//     "We're waiting for the designer's opinion."
//   Phase 2 — recommendation overlay on the carousels:
//     "Claude is thinking about your preferences and picking a
//      design direction."
//
// Without this split both phases would hide behind one combined
// spinner, which makes the ~25s feel longer than it is.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { synthesiseBrief } from '@/lib/brief/synthesiser';
import { listPalettes } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RecommendBody {
  roomId?: string;
  projectId?: string | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RecommendBody;
  const { roomId, projectId } = body;
  if (!roomId) return NextResponse.json({ error: 'Missing roomId.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Fetch the cached room analysis. Ownership check via user_id.
  const roomRes = await admin
    .from('rooms')
    .select('id, user_id, analysis')
    .eq('id', roomId)
    .maybeSingle();
  const room = roomRes.data as
    | { id: string; user_id: string; analysis: RoomAnalysis | null }
    | null;
  if (!room || room.user_id !== user.id) {
    return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
  }
  if (!room.analysis) {
    // No vision result to ground the synth in — bail rather than
    // running pure-tag reasoning, which has no edge over the brief-
    // only synth we'd already have cached on the project.
    return NextResponse.json({ recommendation: null });
  }

  // Optional brief tags from the project, when provided. We verify
  // ownership again — projectId might be from a stale URL param.
  let briefTags: string[] = [];
  if (projectId) {
    const pRes = await admin
      .from('projects')
      .select('user_id, brief')
      .eq('id', projectId)
      .maybeSingle();
    const p = pRes.data as
      | { user_id: string; brief?: { tags?: string[] } | null }
      | null;
    if (p && p.user_id === user.id) {
      const brief = p.brief;
      if (brief && Array.isArray(brief.tags)) briefTags = brief.tags;
    }
  }

  try {
    const synthStart = Date.now();
    const synth = await synthesiseBrief(briefTags, room.analysis);
    console.log(`[recommend] synth done in ${Date.now() - synthStart}ms`);

    const palette = listPalettes().find((p) => p.id === synth.recommendation.palette_id);
    const direction: '2026' | 'timeless' | null = palette
      ? palette.timelessness < 7
        ? '2026'
        : 'timeless'
      : null;

    return NextResponse.json({
      recommendation: {
        paletteId: synth.recommendation.palette_id,
        paletteName: palette?.name ?? synth.recommendation.palette_id,
        styleSlug: synth.recommendation.style_slug,
        direction,
        reasoning: synth.recommendation.reasoning,
      },
    });
  } catch (err) {
    console.warn('[recommend] synth failed:', err instanceof Error ? err.message : err);
    // Best-effort. UI falls back to its default palette selection
    // if recommendation is null.
    return NextResponse.json({ recommendation: null });
  }
}
