// POST /api/render/curate-candidates (#179)
//
// Designer-curated picking step. Called from /rooms/new AFTER the
// palette is chosen but BEFORE the render submits. Returns
// palette+room-fit candidates per core category with wishlist items
// pinned to the front. The CurationStep UI lets the user pick 1-3
// per category; those picks become both the heroProducts for the
// render AND the picking_list (sidestepping Florence-2 + the
// post-render matching).
//
// Auth: user-scoped (RLS via session cookies).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchCurationCandidates } from '@/lib/curation';
import { getStyle } from '@/lib/styles';

export const runtime = 'nodejs';

interface Body {
  roomId?: string;
  paletteId?: string;
  styleSlug?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.roomId || !body.paletteId) {
    return NextResponse.json({ error: 'roomId and paletteId are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  // Verify the room belongs to the calling user.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomRes = await (admin as any)
    .from('rooms')
    .select('id, user_id, analysis')
    .eq('id', body.roomId)
    .single();
  const room = roomRes.data as { id: string; user_id: string; analysis: { room_type?: string | null } | null } | null;
  if (!room || room.user_id !== user.id) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const roomType = room.analysis?.room_type ?? null;
  const style = body.styleSlug ? getStyle(body.styleSlug) : null;
  const styleTags = style ? [...(style.mood ?? []), style.slug] : [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories = await fetchCurationCandidates({
      admin: admin as any,
      userId: user.id,
      roomType,
      paletteId: body.paletteId,
      styleTags,
      perCategory: 8,
    });
    return NextResponse.json({ categories });
  } catch (err) {
    console.error('[curate-candidates] failed', err);
    const msg = err instanceof Error ? err.message : 'Could not fetch curation candidates';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
