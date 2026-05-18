// GET /api/renders/[id]/status
//
// Called by the result page's polling client. Workflow:
//   - Read the render row.
//   - If status is already 'succeeded' or 'failed', return as-is.
//   - If 'running' and there's a fal_request_id, check fal's queue.
//     - If fal still IN_QUEUE / IN_PROGRESS → return { status: 'running' }
//     - If fal COMPLETED → fetch result, upload to storage, run picking
//       list, update DB, return { status: 'succeeded' }
//     - If fal FAILED → mark DB failed, return { status: 'failed', error }
//
// The "finalise" step (fetch + upload + picking list) runs only once, the
// first time we observe fal completion. We use the presence of output_url
// as the idempotency signal — if it's already set, we skip.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRenderStatus, fetchRenderResult } from '@/lib/fal';
import { buildPickingList } from '@/lib/matching';

export const runtime = 'nodejs';
// Finalise step can take 10-20s for picking list + storage upload.
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

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
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
  if (render.status === 'succeeded' || render.status === 'failed' || render.status === 'cancelled') {
    return NextResponse.json({ status: render.status });
  }

  // Running but no fal job — shouldn't happen, but treat as failed so we
  // don't poll forever.
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

  // fal.status === 'completed' — finalise the render.
  // Idempotency: if output_url is already set we've already finalised.
  if (render.output_url) {
    return NextResponse.json({ status: 'succeeded' });
  }

  try {
    const result = await fetchRenderResult(render.fal_request_id);
    const outKey = `${user.id}/${render.id}.webp`;

    const uploadTask = (async () => {
      const bytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
      return admin.storage.from('renders').upload(outKey, bytes, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true,
      });
    })();

    const matchTask = buildPickingList({
      admin,
      renderImageUrl: result.imageUrl,
    }).catch((err) => {
      console.error('picking list build failed', err);
      return { items: [] as unknown[], imageWidth: 0, imageHeight: 0 };
    });

    const [uploadRes, matchRes] = await Promise.all([uploadTask, matchTask]);
    if (uploadRes.error) throw new Error(uploadRes.error.message);
    const pickingList = matchRes.items;

    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        picking_list: pickingList,
        cost_estimate_aud: estimateTotal(pickingList),
        completed_at: new Date().toISOString(),
      })
      .eq('id', render.id);

    return NextResponse.json({ status: 'succeeded' });
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
