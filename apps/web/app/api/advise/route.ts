// POST /api/advise — designer LLM advice for a specific render + palette.
//
// Body: { renderId: string, paletteId: string }
// Returns: DesignerAdvice (structured) — see lib/designer.ts.
//
// Side effect: caches the room's vision analysis on rooms.analysis the first
// time we see it, so subsequent advice requests for the same room skip the
// Claude vision call.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPalette } from '@/lib/palettes';
import { analyseRoom, type RoomAnalysis } from '@/lib/vision';
import { getDesignerAdvice } from '@/lib/designer';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  renderId?: string;
  paletteId?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const renderId = body.renderId;
  const paletteId = body.paletteId;
  if (!renderId || typeof renderId !== 'string') {
    return NextResponse.json({ error: 'Missing renderId' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Look up the render → room (owner check enforced via the render row).
  const renderRes = await admin
    .from('renders')
    .select('id, user_id, room_id')
    .eq('id', renderId)
    .single();
  const render = renderRes.data as { id: string; user_id: string; room_id: string } | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  const roomRes = await admin
    .from('rooms')
    .select('id, photo_url, analysis')
    .eq('id', render.room_id)
    .single();
  const room = roomRes.data as
    | { id: string; photo_url: string; analysis: RoomAnalysis | null }
    | null;
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Get a fresh signed URL for the room photo so Claude vision can fetch it.
  let roomAnalysis = room.analysis;
  if (!roomAnalysis) {
    const signed = await admin.storage.from('rooms').createSignedUrl(room.photo_url, 60 * 5);
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ error: 'Could not sign room photo URL.' }, { status: 500 });
    }
    try {
      roomAnalysis = await analyseRoom(signed.data.signedUrl);
      // Persist the analysis so we never run this twice for the same room.
      await admin.from('rooms').update({ analysis: roomAnalysis }).eq('id', room.id);
    } catch (err) {
      console.error('vision analysis failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Room analysis failed.' },
        { status: 500 },
      );
    }
  }

  const palette = paletteId ? getPalette(paletteId) ?? null : null;

  try {
    const advice = await getDesignerAdvice({ admin, roomAnalysis, palette });
    return NextResponse.json({ advice });
  } catch (err) {
    console.error('designer advice failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Designer advice failed.' },
      { status: 500 },
    );
  }
}
