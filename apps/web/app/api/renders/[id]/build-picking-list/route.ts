// POST /api/renders/[id]/build-picking-list
//
// Two uses:
//   1. (Optional) fired-and-forgotten from /api/renders/[id]/status
//      as a recovery path — though /status now builds inline.
//   2. (Primary) the "Rebuild picking list" button on /renders/[id]
//      calls this directly to refresh the picking list against any
//      newer pipeline changes (e.g. wall-paint pseudo-item, new
//      detection categories) without spending fal credits on a fresh
//      render.
//
// Default behaviour is idempotent — if picking_list is already
// populated we short-circuit. Pass `force=true` to bypass and rebuild
// (used by the manual rebuild button).

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildPickingList } from '@/lib/matching';
import { findPaletteByHexes } from '@/lib/palettes';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RenderRow {
  id: string;
  user_id: string;
  output_url: string | null;
  picking_list: unknown[] | null;
  style_profile_id: string | null;
  room_id: string | null;
}

interface Body {
  force?: boolean;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // Auth check — manual rebuilds run as the render owner so we know
  // the right user is asking. Service-role can also call this from
  // server-side flows (status route) by skipping the cookie check.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const body = (await request.json().catch(() => ({}))) as Body;
  const force = body.force === true;

  const admin = createAdminClient() as unknown as SupabaseClient;

  const renderRes = await admin
    .from('renders')
    .select('id, user_id, output_url, picking_list, style_profile_id, room_id')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render) return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  // Manual rebuilds require ownership. Server-internal calls (no auth
  // cookie) bypass — they're inherently trusted.
  if (user && render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }
  if (!render.output_url) {
    return NextResponse.json({ error: 'Render not finalised yet' }, { status: 400 });
  }

  // Idempotency — skip if already populated UNLESS the caller passed
  // force=true (the manual rebuild button does).
  if (
    !force &&
    Array.isArray(render.picking_list) &&
    render.picking_list.length > 0
  ) {
    return NextResponse.json({ status: 'already_built' });
  }

  // Pull palette from the style profile so wall-paint matching can fire,
  // and reverse-lookup the palette id so the candidate fetcher can apply
  // the palette/room pre-filter (Round 17). Falls back to category-only
  // when either signal is unresolved.
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
    paletteId = findPaletteByHexes(paletteHexes)?.id;
  }

  // Pull room_type for the room filter — same slug shape as
  // palette.recommended_rooms (snake_case).
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
      paletteHexes,
      paletteId,
      roomType,
    });
    await admin
      .from('renders')
      .update({
        picking_list: matchRes.items,
        cost_estimate_aud: estimateTotal(matchRes.items),
      })
      .eq('id', render.id);
    return NextResponse.json({
      status: 'built',
      items: matchRes.items.length,
      labels: matchRes.items.map((i) => i.itemLabel),
    });
  } catch (err) {
    console.error('[build-picking-list] failed', err);
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
