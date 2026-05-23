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
import { listPalettes, paletteDirection } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RecommendBody {
  roomId?: string;
  projectId?: string | null;
  /** Per-render override tags (§6.11 Phase C, #155). When the user
   *  clicks "Customise for this image" on the analyse page, the modal
   *  posts the override tags here. Used in preference to project brief
   *  tags and users.preferences. Does NOT persist anywhere — lives in
   *  this single recommendation. */
  overrideTags?: string[];
}

/** Where the brief tags fed to the synthesiser came from. Surfaced to
 *  the UI so the analyse page can show the right "Using your X" banner
 *  + offer the "Customise for this image" override. */
type RecommendationSource = 'override' | 'project' | 'user_prefs' | 'none';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RecommendBody;
  const { roomId, projectId, overrideTags } = body;
  if (!roomId) return NextResponse.json({ error: 'Missing roomId.' }, { status: 400 });

  // Sanitise override tags so a malformed body can't break the synth.
  const cleanOverrideTags = Array.isArray(overrideTags)
    ? overrideTags
        .filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length < 80)
    : null;

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

  // Resolve which tag set feeds the synthesiser, in strict priority
  // order (§6.11 Phase C, #155):
  //   1. Per-render override (this request's body)
  //   2. Project brief (when projectId provided and user owns it)
  //   3. users.preferences (canonical user-level taste signal)
  //   4. [] (cold-start — pure room-grounded reasoning, today's default)
  // The chosen source is returned to the client so the analyse page
  // can render the right "Using your X" banner + offer the override.
  let briefTags: string[] = [];
  let source: RecommendationSource = 'none';

  if (cleanOverrideTags && cleanOverrideTags.length > 0) {
    briefTags = cleanOverrideTags;
    source = 'override';
  } else if (projectId) {
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
      if (brief && Array.isArray(brief.tags) && brief.tags.length > 0) {
        briefTags = brief.tags;
        source = 'project';
      }
    }
  }

  // If the project path didn't yield tags, fall back to canonical user
  // preferences — closes the cold-start gap on outside-project uploads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (briefTags.length === 0) {
    const prefsRes = await (admin as any)
      .from('users')
      .select('preferences')
      .eq('id', user.id)
      .maybeSingle();
    const prefs = prefsRes.data?.preferences as { tags?: string[] } | null;
    if (prefs && Array.isArray(prefs.tags) && prefs.tags.length > 0) {
      briefTags = prefs.tags;
      source = 'user_prefs';
    }
  }

  try {
    const synthStart = Date.now();
    const synth = await synthesiseBrief(briefTags, room.analysis);
    console.log(
      `[recommend] synth done in ${Date.now() - synthStart}ms (source=${source}, tags=${briefTags.length})`,
    );

    // Use the shared paletteDirection() helper (#167) so the
    // recommendation's direction label matches the carousel the
    // palette appears in. Previously this checked < 7 while the
    // carousel slices used < 9, producing a banner mismatch on
    // palettes with timelessness 7 or 8.
    const palette = listPalettes().find((p) => p.id === synth.recommendation.palette_id);
    const direction = paletteDirection(palette);

    return NextResponse.json({
      recommendation: {
        paletteId: synth.recommendation.palette_id,
        paletteName: palette?.name ?? synth.recommendation.palette_id,
        styleSlug: synth.recommendation.style_slug,
        direction,
        reasoning: synth.recommendation.reasoning,
      },
      source,
      // Echo the tags so the override modal can show the user what
      // their current applied set is when they open it. None-source
      // returns [] (cold-start case).
      appliedTags: briefTags,
    });
  } catch (err) {
    console.warn('[recommend] synth failed:', err instanceof Error ? err.message : err);
    // Best-effort. UI falls back to its default palette selection
    // if recommendation is null.
    return NextResponse.json({ recommendation: null, source, appliedTags: briefTags });
  }
}
