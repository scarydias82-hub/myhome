// /api/projects/[id]/analyse
//
// POST → runs the unified "designer reads your brief + your room"
//        moment from Step 3 of the project wizard.
//
// Sequence:
//   1. Verify the project belongs to the caller.
//   2. Read the project's stored brief.tags.
//   3. Find the project's latest room (no analysis yet, or stale).
//   4. Run analyseRoom (Claude vision on the photo) AND synthesiseBrief
//      sequentially — synthesiser takes the room facts as context so
//      its reasoning grounds in the specific room (light direction,
//      flooring, architecture) rather than being generic.
//   5. Persist room analysis on rooms.analysis + brief response on
//      projects.brief.response.
//   6. Return the combined result.
//
// Why a single endpoint instead of two calls from the client:
//   - One unified loading state for the user
//   - Synthesiser depends on analyseRoom's output (room facts ground
//     the recommendation), so they're sequenced server-side
//   - Lower round-trip latency
//   - Easier to roll back / retry as a unit

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { analyseRoom, type RoomAnalysis, type VisionMediaType } from '@/lib/vision';
import { synthesiseBrief, type BriefSynthesis } from '@/lib/brief/synthesiser';

export const runtime = 'nodejs';
// analyseRoom ~6-10s + synthesiseBrief ~8-12s = ~20s typical. 60s
// ceiling with retry-with-backoff headroom.
export const maxDuration = 60;

interface ProjectBrief {
  tags: string[];
  response: BriefSynthesis | null;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
  brief: ProjectBrief | null;
}

interface RoomRow {
  id: string;
  photo_url: string;
  analysis: RoomAnalysis | null;
}

export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;

  // 1. Verify project ownership.
  const projectRes = await admin
    .from('projects')
    .select('id, user_id, brief')
    .eq('id', id)
    .single();
  const project = projectRes.data as ProjectRow | null;
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // 2. Brief tags required — fail clearly if Step 1 isn't done.
  const tags = project.brief?.tags ?? [];
  if (tags.length === 0) {
    return NextResponse.json(
      { error: 'Complete your brief first (Step 1).' },
      { status: 400 },
    );
  }

  // 3. Find the latest room for this project. Must exist — Step 2
  // gates the wizard from reaching Step 3 without a photo.
  const roomRes = await admin
    .from('rooms')
    .select('id, photo_url, analysis')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const room = roomRes.data as RoomRow | null;
  if (!room) {
    return NextResponse.json(
      { error: 'Upload a room photo first (Step 2).' },
      { status: 400 },
    );
  }

  // Wall-clock instrumentation. The route has a 60s Vercel budget and
  // chains two Claude calls; when it times out we want the logs to
  // tell us which call ate the budget (vision / synthesiser / storage
  // download).
  const t0 = Date.now();
  console.log(
    `[project-analyse] start projectId=${id} roomId=${room.id} cached=${!!room.analysis}`,
  );

  // 4a. Room analysis — re-run only if not already cached. Cached
  // analysis avoids paying a Claude call when the user revisits Step 3.
  // Downloads the photo bytes directly from Supabase Storage and passes
  // them inline to analyseRoom (base64) instead of having Anthropic do
  // a server-side URL fetch — same image, ~1-2s faster per call.
  let roomAnalysis: RoomAnalysis | null = room.analysis;
  if (!roomAnalysis) {
    const dl = await admin.storage.from('rooms').download(room.photo_url);
    if (dl.error || !dl.data) {
      return NextResponse.json({ error: 'Could not load room photo.' }, { status: 500 });
    }
    const buffer = Buffer.from(await dl.data.arrayBuffer());
    const mediaType = (dl.data.type || 'image/jpeg') as VisionMediaType;
    const tDownload = Date.now();
    console.log(
      `[project-analyse] photo downloaded in ${tDownload - t0}ms (${buffer.length} bytes)`,
    );
    try {
      roomAnalysis = await analyseRoom({ buffer, mediaType });
      console.log(`[project-analyse] analyseRoom done in ${Date.now() - tDownload}ms`);
      await admin.from('rooms').update({ analysis: roomAnalysis }).eq('id', room.id);
    } catch (err) {
      console.error(
        `[project-analyse] analyseRoom failed after ${Date.now() - tDownload}ms`,
        err,
      );
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Room analysis failed.' },
        { status: 502 },
      );
    }
  }

  // 4b. Brief synthesis — always re-runs because the room context
  // makes the reasoning specific. If a previous response exists for
  // an older photo or older tags, it's stale by definition.
  const tBeforeSynth = Date.now();
  let briefResponse: BriefSynthesis;
  try {
    briefResponse = await synthesiseBrief(tags, roomAnalysis);
    console.log(`[project-analyse] synthesiseBrief done in ${Date.now() - tBeforeSynth}ms`);
  } catch (err) {
    console.error(
      `[project-analyse] synthesiseBrief failed after ${Date.now() - tBeforeSynth}ms`,
      err,
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Designer call failed.' },
      { status: 502 },
    );
  }

  // 5. Persist the response onto the project brief, preserving tags.
  const updatedBrief: ProjectBrief = {
    tags,
    response: briefResponse,
    updated_at: new Date().toISOString(),
  };
  const { error: updateErr } = await admin
    .from('projects')
    .update({ brief: updatedBrief, updated_at: updatedBrief.updated_at })
    .eq('id', project.id);
  if (updateErr) {
    console.error('[analyse] persist failed', updateErr);
    // Still return — user gets the value, log will diagnose persistence
    // breakage separately.
  }

  console.log(`[project-analyse] complete in ${Date.now() - t0}ms total`);

  return NextResponse.json({
    roomId: room.id,
    roomAnalysis,
    briefResponse,
    updated_at: updatedBrief.updated_at,
  });
}
