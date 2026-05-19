// GET /api/renders/[id]/status
//
// Polled by the render page. Each call:
//   - Reads the render row.
//   - If already 'succeeded'/'failed'/'cancelled', returns as-is.
//   - If 'running' and fal still busy, returns { status: 'running' }.
//   - If 'running' and fal completed, fast-finalises (download + storage
//     upload + flip status to 'succeeded') and fires off
//     POST /api/renders/[id]/build-picking-list in the background to do
//     the slow Florence-2 + Claude work. Returns 'succeeded' so the page
//     can show the image immediately; the picking list arrives on a
//     subsequent poll once the background job lands.
//
// Splitting fast finalise from slow picking-list build keeps each step
// well within Vercel's 60s function cap. Previously a 90s picking-list
// build would kill the whole finalise, the renders row would never
// update, and the next poll would repeat the same expensive work —
// trapping users in 5+ minute "running" loops.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRenderStatus, fetchRenderResult } from '@/lib/fal';

export const runtime = 'nodejs';
// Status route is now FAST — only the storage upload runs inline. The
// heavy picking-list work happens in /build-picking-list with its own
// 60s budget.
export const maxDuration = 30;

interface RenderRow {
  id: string;
  user_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output_url: string | null;
  picking_list: unknown;
  cost_estimate_aud: number | null;
  fal_request_id: string | null;
  completed_at: string | null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const renderRes = await admin
    .from('renders')
    .select('id, user_id, status, output_url, picking_list, cost_estimate_aud, fal_request_id, completed_at')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  // Terminal states — but for 'succeeded' renders without a picking
  // list yet, also kick off a background build (handles the case where
  // a previous status call set 'succeeded' but the build endpoint
  // never landed). Idempotent — the build endpoint short-circuits if
  // picking_list is already populated.
  if (render.status === 'succeeded') {
    const pickingListEmpty = !Array.isArray(render.picking_list) || render.picking_list.length === 0;
    if (pickingListEmpty) triggerPickingListBuild(request, render.id);
    return NextResponse.json({
      status: 'succeeded',
      pickingListReady: !pickingListEmpty,
    });
  }
  if (render.status === 'failed' || render.status === 'cancelled') {
    return NextResponse.json({ status: render.status });
  }

  // Running but no fal job — shouldn't happen, but treat as failed so
  // we don't poll forever.
  if (!render.fal_request_id) {
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    return NextResponse.json({ status: 'failed', error: 'No fal request id' });
  }

  const fal = await checkRenderStatus(render.fal_request_id);

  if (fal.status === 'in_queue' || fal.status === 'in_progress') {
    return NextResponse.json({ status: 'running', falStatus: fal.status });
  }

  if (fal.status === 'failed') {
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    return NextResponse.json({ status: 'failed' });
  }

  // fal.status === 'completed' — fast finalise.
  // Idempotency: if output_url is already set we've already finalised.
  if (render.output_url) {
    triggerPickingListBuild(request, render.id);
    return NextResponse.json({ status: 'succeeded', pickingListReady: false });
  }

  try {
    const result = await fetchRenderResult(render.fal_request_id);
    const outKey = `${user.id}/${render.id}.webp`;
    const bytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
    const upload = await admin.storage.from('renders').upload(outKey, bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        completed_at: new Date().toISOString(),
      })
      .eq('id', render.id);

    // Fire and forget — picking list build runs in its own 60s function
    // invocation. The status route returns immediately so the page can
    // show the rendered image; the picking list lands on a subsequent
    // poll once the background job completes.
    triggerPickingListBuild(request, render.id);

    return NextResponse.json({ status: 'succeeded', pickingListReady: false });
  } catch (err) {
    console.error('finalise render failed', err);
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    return NextResponse.json(
      { status: 'failed', error: err instanceof Error ? err.message : 'Finalise failed' },
      { status: 500 },
    );
  }
}

// Trigger /api/renders/[id]/build-picking-list without awaiting the
// response so the status route can return immediately. We derive the
// origin from the incoming request so this works on Vercel preview,
// production and localhost without an env var.
function triggerPickingListBuild(request: Request, renderId: string) {
  try {
    const origin = new URL(request.url).origin;
    void fetch(`${origin}/api/renders/${renderId}/build-picking-list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Forward cookies so the build endpoint can resolve the user if
      // it ever needs to — currently it's admin-only but keeping the
      // session cookie around costs us nothing.
      ...(request.headers.get('cookie') ? { headers: { cookie: request.headers.get('cookie') as string } } : {}),
    }).catch((err) => console.error('[trigger] build-picking-list fetch failed', err));
  } catch (err) {
    console.error('[trigger] could not initiate build-picking-list', err);
  }
}
