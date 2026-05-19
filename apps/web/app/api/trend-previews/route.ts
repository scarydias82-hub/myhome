// GET /api/trend-previews?roomType=living_room
//
// Returns one trend-card preview per palette so the upload form's
// palette picker can show the user what each palette actually looks
// like applied to a room similar to theirs. Falls back gracefully:
//   - Prefer a trend card with the requested room_type
//   - If none exists for a given palette, return any trend card we
//     have for that palette regardless of room type
//   - Palettes with no trend cards at all are simply absent from the
//     response; the picker shows just the swatch for those
//
// trend_cards images live in a PUBLIC storage bucket so we can return
// public URLs directly — no signing round-trip.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface TrendCardRow {
  palette_id: string;
  room_type: string;
  headline: string;
  image_storage_key: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const requestedRoomType = request.nextUrl.searchParams.get('roomType') ?? null;

  const admin = createAdminClient() as unknown as SupabaseClient;
  // Newest first — if a palette has multiple cards in the same room type
  // we prefer the most recent generation.
  const { data, error } = await admin
    .from('trend_cards')
    .select('palette_id, room_type, headline, image_storage_key')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allCards = (data as TrendCardRow[] | null) ?? [];
  if (allCards.length === 0) {
    return NextResponse.json({ previews: [] });
  }

  // Two-pass selection: prefer the requested room type, then fall back
  // to any room type per palette.
  const byPalette = new Map<string, TrendCardRow>();
  if (requestedRoomType) {
    for (const card of allCards) {
      if (card.room_type === requestedRoomType && !byPalette.has(card.palette_id)) {
        byPalette.set(card.palette_id, card);
      }
    }
  }
  for (const card of allCards) {
    if (!byPalette.has(card.palette_id)) {
      byPalette.set(card.palette_id, card);
    }
  }

  // Build public URLs from the storage key. Trend cards live in a
  // public bucket so getPublicUrl is sync and cheap.
  const previews = [...byPalette.values()].map((card) => ({
    paletteId: card.palette_id,
    headline: card.headline,
    roomType: card.room_type,
    matchedRoomType: requestedRoomType ? card.room_type === requestedRoomType : false,
    imageUrl: admin.storage.from('trends').getPublicUrl(card.image_storage_key).data.publicUrl,
  }));

  return NextResponse.json({ previews });
}
