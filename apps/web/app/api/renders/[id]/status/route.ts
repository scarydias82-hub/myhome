// GET /api/renders/[id]/status
//
// Polled by the render page. Two-stage completion model (2026-05-22):
// the render image and the picking list complete independently so the
// user sees the rendered room ~30s after submit instead of waiting
// 60-90s for everything to land at once.
//
// Each call:
//   - Reads the render row (status + picking_list_status + ...).
//   - If both stages terminal, returns as-is.
//   - If 'running' and fal still busy, returns the running state.
//   - If 'running' and fal just completed:
//       FOREGROUND (~5s):
//         a. Download the Flux result, upload to the renders bucket
//         b. UPDATE: status='succeeded', output_url, picking_list_status='building'
//         c. Schedule picking-list build via after()
//         d. Return immediately so the polling client refreshes the
//            page and the user sees the rendered image
//       BACKGROUND (after(), ~25-30s):
//         e. Run Florence-2 + matcher + wall-paint
//         f. UPDATE: picking_list, picking_list_status='ready' (or 'failed')
//   - If output_url set and picking_list_status='building':
//       Return current state, poll continues to catch the 'ready' flip.
//       TTL: if building > 120s, mark 'failed' so polls don't run forever.
//
// Pre-2026-05-22 this route did everything in one blocking call.
// `void fetch()` after return was tried and failed (Vercel killed the
// function before the outbound request initiated). `after()` is the
// supported pattern — runs in the response's worker after the response
// is flushed, bounded by maxDuration.

import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkActiveStatus, fetchActiveResult } from '@/lib/fal';
import { buildPickingList } from '@/lib/matching';
import { findPaletteByHexes } from '@/lib/palettes';

export const runtime = 'nodejs';
// Foreground (image save) is ~5s; after() (matching) is ~25-30s. 120s
// gives the matching pipeline comfortable headroom even if a slow Claude
// retry kicks in. The response flushes after the foreground work, so
// the user perceives ~5s, not 120s.
export const maxDuration = 120;

// If picking_list_status has been 'building' for longer than this,
// assume the previous after() got killed and mark the build as failed
// so the user isn't stuck polling forever. They can retry via the
// rebuild button.
const PICKING_LIST_BUILD_TTL_MS = 120_000;

type PickingListStatus = 'not_started' | 'building' | 'ready' | 'failed';

interface RenderRow {
  id: string;
  user_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output_url: string | null;
  picking_list: unknown;
  picking_list_status: PickingListStatus | null;
  cost_estimate_aud: number | null;
  fal_request_id: string | null;
  completed_at: string | null;
  style_profile_id: string | null;
  room_id: string | null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const renderRes = await admin
    .from('renders')
    .select(
      'id, user_id, status, output_url, picking_list, picking_list_status, cost_estimate_aud, fal_request_id, completed_at, style_profile_id, room_id',
    )
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  const pickingListStatus: PickingListStatus = render.picking_list_status ?? 'not_started';

  // TTL guard: if the picking-list build has been "building" longer
  // than PICKING_LIST_BUILD_TTL_MS without completing, the previous
  // after() got killed. Mark it failed so polls stop and the rebuild
  // button is the user's recovery path.
  if (
    pickingListStatus === 'building' &&
    render.completed_at &&
    Date.now() - new Date(render.completed_at).getTime() > PICKING_LIST_BUILD_TTL_MS
  ) {
    console.warn(`[status] picking-list build TTL exceeded for ${render.id}, marking failed`);
    await admin
      .from('renders')
      .update({ picking_list_status: 'failed' })
      .eq('id', render.id);
    return NextResponse.json({
      status: render.status,
      pickingListStatus: 'failed',
      pickingListError: 'Build exceeded time budget — try the rebuild button.',
    });
  }

  // Terminal states. The render lifecycle now has two terminal axes:
  // status (image render) and picking_list_status (matching). The
  // client should stop polling only when BOTH are terminal.
  const renderTerminal =
    render.status === 'succeeded' ||
    render.status === 'failed' ||
    render.status === 'cancelled';
  const pickingListTerminal =
    pickingListStatus === 'ready' ||
    pickingListStatus === 'failed' ||
    // not_started is terminal if the render itself failed/cancelled —
    // no point building a list for a render that doesn't exist.
    (pickingListStatus === 'not_started' && render.status !== 'succeeded');
  if (renderTerminal && pickingListTerminal) {
    return NextResponse.json({
      status: render.status,
      pickingListStatus,
    });
  }

  // Image already saved but matching still in progress. Just report
  // current state — the after() worker on a prior poll is doing the
  // build, no new work to kick off here.
  if (render.output_url && pickingListStatus === 'building') {
    return NextResponse.json({
      status: render.status,
      pickingListStatus,
    });
  }

  // Running but no fal job — shouldn't happen; mark failed so we don't
  // poll forever.
  if (!render.fal_request_id) {
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json({
      status: 'failed',
      pickingListStatus: 'failed',
      error: 'No fal request id',
    });
  }

  // Provider-aware: dispatches to flux-general or kontext-multi based
  // on FLUX_PROVIDER env var. Default kontext-multi post-round-14.
  const fal = await checkActiveStatus(render.fal_request_id);

  if (fal.status === 'in_queue' || fal.status === 'in_progress') {
    return NextResponse.json({
      status: 'running',
      falStatus: fal.status,
      pickingListStatus,
    });
  }

  if (fal.status === 'failed') {
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json({ status: 'failed', pickingListStatus: 'failed' });
  }

  // fal.status === 'completed' — foreground: save image. Background
  // (after()): build picking list. Idempotency: if output_url is
  // already set we've already done the foreground; just report state.
  if (render.output_url) {
    return NextResponse.json({
      status: 'succeeded',
      pickingListStatus,
    });
  }

  try {
    const result = await fetchActiveResult(render.fal_request_id);
    const outKey = `${user.id}/${render.id}.webp`;

    // Step 1 (foreground, ~5s): download fal result, upload to storage.
    const bytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
    const upload = await admin.storage.from('renders').upload(outKey, bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    // Step 2 (foreground): mark image-stage succeeded + flip
    // picking_list_status to 'building'. The 'building' flag is what
    // tells subsequent polls "image is ready, matching is in flight,
    // keep polling but don't kick off another build."
    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        completed_at: new Date().toISOString(),
        picking_list_status: 'building',
      })
      .eq('id', render.id);

    // Pre-fetch palette + room context. We do this in the foreground
    // because the rows are small and we'd rather fail fast (palette
    // missing → wall-paint match skipped) than crash the background
    // task. The after() worker then runs purely against in-memory
    // values + fal CDN.
    let paletteHexes: string[] | undefined;
    let paletteId: string | undefined;
    if (render.style_profile_id) {
      const profileRes = await admin
        .from('style_profiles')
        .select('palette')
        .eq('id', render.style_profile_id)
        .single();
      const profile = profileRes.data as { palette: string[] | null } | null;
      paletteHexes = profile?.palette ?? undefined;
      const palette = findPaletteByHexes(paletteHexes);
      paletteId = palette?.id;
    }

    let roomType: string | undefined;
    if (render.room_id) {
      const roomRes = await admin
        .from('rooms')
        .select('analysis, room_type')
        .eq('id', render.room_id)
        .single();
      const room = roomRes.data as {
        analysis: { room_type?: string | null } | null;
        room_type: string | null;
      } | null;
      const rawRoomType = room?.analysis?.room_type ?? room?.room_type ?? undefined;
      if (rawRoomType) roomType = rawRoomType.toLowerCase().replace(/\s+/g, '_');
    }
    if (paletteId || roomType) {
      console.log(`[status] picking-list filter context: palette=${paletteId} room=${roomType}`);
    }

    // Step 3 (BACKGROUND via after()): run Florence-2 + matcher +
    // wall-paint. Runs after the response is flushed so the client
    // sees the image-ready state immediately. Bounded by maxDuration
    // (120s); recovery is the TTL guard at the top of the handler.
    const renderImageUrl = result.imageUrl;
    const renderId = render.id;
    after(async () => {
      try {
        console.log(`[status:after] building picking list for ${renderId}`);
        const matchRes = await buildPickingList({
          admin,
          renderImageUrl,
          paletteHexes,
          paletteId,
          roomType,
        });
        await admin
          .from('renders')
          .update({
            picking_list: matchRes.items,
            cost_estimate_aud: estimateTotal(matchRes.items),
            picking_list_status: 'ready',
          })
          .eq('id', renderId);
        console.log(
          `[status:after] picking list ready for ${renderId} — ${matchRes.items.length} items`,
        );
      } catch (err) {
        console.error(`[status:after] picking list build failed for ${renderId}`, err);
        await admin
          .from('renders')
          .update({ picking_list_status: 'failed' })
          .eq('id', renderId);
      }
    });

    return NextResponse.json({
      status: 'succeeded',
      pickingListStatus: 'building',
    });
  } catch (err) {
    console.error('finalise render failed', err);
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json(
      {
        status: 'failed',
        pickingListStatus: 'failed',
        error: err instanceof Error ? err.message : 'Finalise failed',
      },
      { status: 500 },
    );
  }
}

function estimateTotal(items: unknown[]): number | null {
  let total = 0;
  let counted = 0;
  for (const raw of items) {
    const item = raw as { matches?: Array<{ priceAud: number | null }> };
    const cheapest = (item.matches ?? [])
      .map((m) => m.priceAud)
      .filter((p): p is number => typeof p === 'number' && p > 0)
      .sort((a, b) => a - b)[0];
    if (cheapest != null) {
      total += cheapest;
      counted++;
    }
  }
  return counted > 0 ? Math.round(total) : null;
}
