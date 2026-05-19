// GET /api/renders/[id]/status
//
// Polled by the render page. Each call:
//   - Reads the render row.
//   - If terminal ('succeeded'/'failed'/'cancelled'), returns as-is.
//   - If 'running' and fal still busy, returns { status: 'running' }.
//   - If 'running' and fal completed, finalises inline:
//       a. Download the Flux result, upload to the renders bucket
//       b. Run the picking-list pipeline (Florence-2 + Claude
//          validator + Claude ranker)
//       c. Update the renders row in one go (status + output_url +
//          picking_list + cost) so the page sees everything together
//     The previous design split this into two functions with a
//     fire-and-forget fetch, but `void fetch()` after `return` was
//     unreliable — Vercel would kill the function before the outbound
//     request initiated, so /build-picking-list never ran and the user
//     saw "no items detected yet" forever.
//
// With density tuned down (MAX_ITEMS 12, CANDIDATES_PER_ITEM 8) the
// full pipeline fits comfortably inside the 60s function budget. If a
// slow Claude call ever pushes us over, the catch block falls back to
// an empty picking list rather than leaving the render trapped.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRenderStatus, fetchRenderResult } from '@/lib/fal';
import { buildPickingList } from '@/lib/matching';

export const runtime = 'nodejs';
// Full finalise (upload + picking list) fits inside 60s for typical
// renders. The picking-list density was tuned specifically to land here.
export const maxDuration = 60;

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
    .select('id, user_id, status, output_url, picking_list, cost_estimate_aud, fal_request_id, completed_at')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  // Terminal states — nothing more to do.
  if (
    render.status === 'succeeded' ||
    render.status === 'failed' ||
    render.status === 'cancelled'
  ) {
    return NextResponse.json({ status: render.status });
  }

  // Running but no fal job — shouldn't happen; mark failed so we don't
  // poll forever.
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

  // fal.status === 'completed' — finalise inline.
  // Idempotency: if output_url is already set we've already finalised.
  if (render.output_url) {
    return NextResponse.json({ status: 'succeeded' });
  }

  try {
    const result = await fetchRenderResult(render.fal_request_id);
    const outKey = `${user.id}/${render.id}.webp`;

    // Step 1: download fal result, upload to storage. This is fast (~5s).
    const bytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
    const upload = await admin.storage.from('renders').upload(outKey, bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    // Step 2: build picking list. Detection + validation + matching
    // runs against the public CDN URL fal gave us (still valid for the
    // brief window between completion and our storage upload).
    let pickingList: unknown[] = [];
    let costEstimate: number | null = null;
    try {
      const matchRes = await buildPickingList({
        admin,
        renderImageUrl: result.imageUrl,
      });
      pickingList = matchRes.items;
      costEstimate = estimateTotal(matchRes.items);
    } catch (err) {
      // Picking list failure shouldn't kill the render — image still
      // gets shown, user can request a rebuild via /build-picking-list
      // if needed.
      console.error('[status] inline picking list failed', err);
    }

    // Step 3: one atomic update so the page sees everything together.
    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        picking_list: pickingList,
        cost_estimate_aud: costEstimate,
        completed_at: new Date().toISOString(),
      })
      .eq('id', render.id);

    return NextResponse.json({
      status: 'succeeded',
      pickingListItems: pickingList.length,
    });
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
