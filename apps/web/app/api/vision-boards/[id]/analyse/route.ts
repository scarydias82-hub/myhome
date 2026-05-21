// POST /api/vision-boards/[id]/analyse — runs Claude analysis on
//   a board (coherence + room styles + cross-app popularity +
//   retailer suggestions). ~$0.05–0.10 per call. Cached in
//   vision_board_analyses; clients can call GET to fetch the
//   latest without spending another Claude call.
//
// GET  /api/vision-boards/[id]/analyse — returns the latest cached
//   analysis if one exists; 404 if the board has never been
//   analysed.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runBoardAnalysis, getLatestAnalysis } from '@/lib/vision-board-analysis';

export const runtime = 'nodejs';
// Claude call + popularity SQL + insert. Real-world ~10-20s; give
// retry headroom.
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await ctx.params;

  // Ownership check via the user-scoped client — RLS guarantees
  // we only see boards we own.
  const ownershipRes = await supabase
    .from('vision_boards')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!ownershipRes.data) {
    return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
  }

  // From here on use the admin client so the popularity computation
  // can see across-user data.
  const admin = createAdminClient() as unknown as SupabaseClient;

  try {
    const { response, snapshot } = await runBoardAnalysis(admin, id);
    return NextResponse.json({ ok: true, response, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vision-board-analyse] failed', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await ctx.params;

  // Ownership check + latest analysis fetch. We use the user
  // client for ownership and the admin client only when we need
  // cross-user popularity reads inside POST.
  const ownershipRes = await supabase
    .from('vision_boards')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!ownershipRes.data) {
    return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const latest = await getLatestAnalysis(admin, id);
  if (!latest) {
    return NextResponse.json({ ok: true, analysis: null });
  }
  return NextResponse.json({ ok: true, analysis: latest });
}
