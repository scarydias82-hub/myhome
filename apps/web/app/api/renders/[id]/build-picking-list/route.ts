// POST /api/renders/[id]/build-picking-list
//
// Fired-and-forgotten from /api/renders/[id]/status the moment we
// finalise the Flux render (download + storage upload). Runs the
// expensive picking-list pipeline (Florence-2 detection × 2 + Claude
// validator × N + Claude ranker × N) in its OWN 60-second function
// invocation so the status route doesn't have to fit everything inside
// the Vercel Hobby cap.
//
// Idempotency: if picking_list is already populated on the renders row
// we return early — multiple concurrent polls calling this endpoint
// don't waste API spend.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildPickingList } from '@/lib/matching';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RenderRow {
  id: string;
  user_id: string;
  output_url: string | null;
  picking_list: unknown[] | null;
}

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const renderRes = await admin
    .from('renders')
    .select('id, user_id, output_url, picking_list')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render) return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  if (!render.output_url) {
    return NextResponse.json({ error: 'Render not finalised yet' }, { status: 400 });
  }

  // Idempotency — if picking_list is already populated, skip. This is
  // intentionally fired and forgotten from /status so a poll storm could
  // queue several of these in flight; the early-return prevents
  // duplicate Claude spend.
  if (Array.isArray(render.picking_list) && render.picking_list.length > 0) {
    return NextResponse.json({ status: 'already_built' });
  }

  // Sign a fresh URL for the render image so matching can pull it.
  const signed = await admin.storage
    .from('renders')
    .createSignedUrl(render.output_url, 60 * 60);
  if (!signed.data?.signedUrl) {
    return NextResponse.json({ error: 'Could not sign render URL' }, { status: 500 });
  }

  try {
    const matchRes = await buildPickingList({
      admin,
      renderImageUrl: signed.data.signedUrl,
    });
    await admin
      .from('renders')
      .update({
        picking_list: matchRes.items,
        cost_estimate_aud: estimateTotal(matchRes.items),
      })
      .eq('id', render.id);
    return NextResponse.json({ status: 'built', items: matchRes.items.length });
  } catch (err) {
    console.error('[build-picking-list] failed', err);
    // Persist an empty list so we don't retry forever. The user can
    // request a rebuild manually if needed.
    await admin.from('renders').update({ picking_list: [] }).eq('id', render.id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Build failed' },
      { status: 500 },
    );
  }
}

function estimateTotal(items: Array<{ matches?: Array<{ priceAud: number | null }> }>): number | null {
  let total = 0;
  let counted = 0;
  for (const item of items) {
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
