// POST /api/analyse-room
//
// Receives a room photo (multipart) and a Claude-vision-grounded analysis
// back. Persists the photo to Supabase Storage and the analysis JSON on
// the rooms row so we never re-analyse the same room.
//
// Output: { roomId, analysis } — the client then displays the analysis,
// lets the user confirm or correct it, and finally POSTs to /api/render
// with the roomId + chosen style.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { analyseRoom, type VisionMediaType } from '@/lib/vision';
import { synthesiseBrief } from '@/lib/brief/synthesiser';
import { listPalettes } from '@/lib/palettes';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const photo = form?.get('photo');
  const projectIdRaw = form?.get('projectId');
  const projectId = typeof projectIdRaw === 'string' && projectIdRaw.length > 0 ? projectIdRaw : null;
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: 'Missing photo.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(photo.type)) {
    return NextResponse.json(
      { error: 'Photo must be JPG, PNG, or WebP. (HEIC is converted in the browser.)' },
      { status: 400 },
    );
  }
  if (photo.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Photo over 15 MB.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Mirror the upsert from the original render route — public.users mirrors
  // auth.users but the trigger sometimes misses confirmed sign-ups.
  await admin
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id' });

  // Upload the photo to storage.
  const ext = extFromMime(photo.type);
  const photoKey = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  const upload = await admin.storage.from('rooms').upload(photoKey, photoBytes, {
    contentType: photo.type,
    cacheControl: '3600',
  });
  if (upload.error) {
    console.error('rooms upload failed', upload.error);
    return NextResponse.json({ error: 'Could not store the room photo.' }, { status: 500 });
  }

  // Verify the project belongs to the caller before linking.
  let verifiedProjectId: string | null = null;
  if (projectId) {
    const pRes = await admin.from('projects').select('id, user_id').eq('id', projectId).single();
    const p = pRes.data as { id: string; user_id: string } | null;
    if (p && p.user_id === user.id) verifiedProjectId = p.id;
  }

  // Insert the room row.
  const roomRes = await admin
    .from('rooms')
    .insert({ user_id: user.id, photo_url: photoKey, project_id: verifiedProjectId })
    .select('id')
    .single();
  const room = roomRes.data as { id: string } | null;
  if (roomRes.error || !room) {
    console.error('room insert failed', roomRes.error);
    return NextResponse.json({ error: 'Could not create room record.' }, { status: 500 });
  }

  console.log(`[analyse-room] start roomId=${room.id}`);
  const startedAt = Date.now();

  // Run vision. Cache on rooms.analysis so /api/advise + /api/render can read
  // it directly without re-analysing. Pass the photo bytes we already have
  // in memory as base64 instead of a signed URL — avoids a ~1-2s round-trip
  // where Anthropic would otherwise have to fetch Supabase server-side.
  try {
    const analysis = await analyseRoom({
      buffer: Buffer.from(photoBytes),
      mediaType: photo.type as VisionMediaType,
    });
    const visionMs = Date.now() - startedAt;
    console.log(`[analyse-room] vision done in ${visionMs}ms`);
    await admin.from('rooms').update({ analysis }).eq('id', room.id);
    console.log(`[analyse-room] cached analysis on rooms.${room.id}`);

    // After vision: run a room-grounded recommendation through the
    // brief synthesiser. This produces palette + style picks that
    // consider the ACTUAL photo's light, flooring, and architecture,
    // not just the brief tags. The upload form pre-selects these in
    // the carousels so the user sees a confident designer's pick
    // before they tap into the chooser.
    //
    // When projectId is set we pass the project's brief tags too so
    // the recommendation respects what the user said they wanted
    // (e.g., "calm, neutral, child-friendly") in addition to what
    // Claude sees. When projectId is null we pass an empty array —
    // the synthesiser falls back to pure room-facts reasoning.
    //
    // Failures don't block the response: if synth times out or
    // Claude returns junk JSON, we just omit `recommendation` and
    // the UI defers to its existing default palette selection.
    let recommendation: {
      paletteId: string;
      paletteName: string;
      styleSlug: string;
      direction: '2026' | 'timeless' | null;
      reasoning: string;
    } | null = null;
    try {
      let briefTags: string[] = [];
      if (verifiedProjectId) {
        const briefRes = await admin
          .from('projects')
          .select('brief')
          .eq('id', verifiedProjectId)
          .maybeSingle();
        const brief = (briefRes.data as { brief?: { tags?: string[] } } | null)?.brief;
        if (brief?.tags && Array.isArray(brief.tags)) briefTags = brief.tags;
      }

      const synthStart = Date.now();
      const synth = await synthesiseBrief(briefTags, analysis);
      console.log(`[analyse-room] synth done in ${Date.now() - synthStart}ms`);

      // Direction is derived from the recommended palette's
      // timelessness — < 7 = trend-forward (2026 carousel),
      // >= 7 = heritage/classic (Tried & tested carousel),
      // missing palette = no direction (just shows palette pick).
      const palette = listPalettes().find((p) => p.id === synth.recommendation.palette_id);
      const direction: '2026' | 'timeless' | null = palette
        ? palette.timelessness < 7
          ? '2026'
          : 'timeless'
        : null;

      recommendation = {
        paletteId: synth.recommendation.palette_id,
        paletteName: palette?.name ?? synth.recommendation.palette_id,
        styleSlug: synth.recommendation.style_slug,
        direction,
        reasoning: synth.recommendation.reasoning,
      };
    } catch (err) {
      // Synth is best-effort. Log and move on — the carousels still
      // work without a pre-selection.
      console.warn(
        '[analyse-room] recommendation synth failed, returning analysis only:',
        err instanceof Error ? err.message : err,
      );
    }

    return NextResponse.json({ roomId: room.id, analysis, recommendation });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(`[analyse-room] failed after ${elapsed}ms`, err);
    return NextResponse.json(
      {
        roomId: room.id,
        analysis: null,
        error: err instanceof Error ? err.message : 'Room analysis failed.',
      },
      { status: 200 },
    );
  }
}

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'webp';
}
