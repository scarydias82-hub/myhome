// Vision board items — add (POST).
//
// Body shape (polymorphic):
//   { itemType: 'palette', paletteId: string, caption?: string }
//   { itemType: 'trend',   trendCardId: string, caption?: string }
//   { itemType: 'product', productId: string, caption?: string }
//   { itemType: 'note',    body: string }
//
// Returns 200 with { id } on insert, 200 with { id, duplicate: true }
// when the same artefact is already in the board (we treat this as
// success rather than a 4xx — the user got what they wanted).

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

type AddItemBody =
  | { itemType: 'palette'; paletteId: string; caption?: string }
  | { itemType: 'trend'; trendCardId: string; caption?: string }
  | { itemType: 'product'; productId: string; caption?: string }
  | { itemType: 'note'; body: string };

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: boardId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as AddItemBody;

  if (!body || typeof body !== 'object' || !('itemType' in body)) {
    return NextResponse.json({ error: 'Missing itemType.' }, { status: 400 });
  }

  // Build the insert row based on the discriminated union. The
  // polymorphic check constraint on the DB will reject malformed
  // shapes, but we validate here too for friendlier errors.
  const insertRow: Record<string, unknown> = {
    board_id: boardId,
    item_type: body.itemType,
    payload: {},
  };

  switch (body.itemType) {
    case 'palette':
      if (!body.paletteId) {
        return NextResponse.json({ error: 'paletteId required.' }, { status: 400 });
      }
      insertRow.palette_id = body.paletteId;
      if (body.caption) insertRow.payload = { caption: body.caption };
      break;
    case 'trend':
      if (!body.trendCardId) {
        return NextResponse.json({ error: 'trendCardId required.' }, { status: 400 });
      }
      insertRow.trend_card_id = body.trendCardId;
      if (body.caption) insertRow.payload = { caption: body.caption };
      break;
    case 'product':
      if (!body.productId) {
        return NextResponse.json({ error: 'productId required.' }, { status: 400 });
      }
      insertRow.product_id = body.productId;
      if (body.caption) insertRow.payload = { caption: body.caption };
      break;
    case 'note':
      if (!body.body?.trim()) {
        return NextResponse.json({ error: 'Note body required.' }, { status: 400 });
      }
      insertRow.payload = { body: body.body.trim() };
      break;
    default:
      return NextResponse.json({ error: 'Unknown itemType.' }, { status: 400 });
  }

  // RLS on the items table requires the board to be owned by the
  // user — Postgres will reject the insert otherwise, no extra
  // check needed here.
  // Cast the typed client to a generic SupabaseClient — the
  // generated DB types can't infer the polymorphic row shape, and
  // we've already validated the row above.
  const client = supabase as unknown as SupabaseClient;
  const res = await client
    .from('vision_board_items')
    .insert(insertRow)
    .select('id')
    .maybeSingle();
  const row = res.data as { id: string } | null;

  // Unique constraint violations (palette/trend/product already in
  // this board) come back as Postgres 23505. We treat that as
  // success — the user's intent ("add this to the board") is
  // already satisfied.
  if (res.error) {
    if (res.error.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('vision_board_item insert failed', res.error);
    return NextResponse.json({ error: 'Could not add item.' }, { status: 500 });
  }
  return NextResponse.json({ id: row?.id ?? null });
}
