// Single vision board — get, rename, delete.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface BoardItemRow {
  id: string;
  item_type: 'palette' | 'trend' | 'product' | 'note';
  palette_id: string | null;
  trend_card_id: string | null;
  product_id: string | null;
  payload: Record<string, unknown>;
  position: number;
  created_at: string;
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await ctx.params;

  // RLS scopes both queries to the owner — no admin client needed.
  const [boardRes, itemsRes] = await Promise.all([
    supabase
      .from('vision_boards')
      .select('id, name, cover_image_url, item_count, created_at, updated_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('vision_board_items')
      .select('id, item_type, palette_id, trend_card_id, product_id, payload, position, created_at')
      .eq('board_id', id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  if (boardRes.error) {
    console.error('vision_board fetch failed', boardRes.error);
    return NextResponse.json({ error: 'Could not load board.' }, { status: 500 });
  }
  if (!boardRes.data) {
    return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
  }

  const items = (itemsRes.data as BoardItemRow[] | null) ?? [];

  // Hydrate item details — fetch the underlying rows the items
  // reference (trend cards + products). Palettes are static from
  // palettes.json so we don't need a DB hop; the client can
  // resolve them from the slug.
  const trendIds = items.filter((i) => i.trend_card_id).map((i) => i.trend_card_id as string);
  const productIds = items.filter((i) => i.product_id).map((i) => i.product_id as string);

  const [trendsRes, productsRes] = await Promise.all([
    trendIds.length > 0
      ? supabase
          .from('trend_cards')
          .select(
            'id, palette_id, palette_name, room_type, headline, description, image_storage_key',
          )
          .in('id', trendIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    productIds.length > 0
      ? supabase
          .from('products')
          .select(
            'id, name, retailer, price_aud, image_url, product_url, affiliate_url, category, style_tags',
          )
          .in('id', productIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  return NextResponse.json({
    board: boardRes.data,
    items,
    trends: trendsRes.data ?? [],
    products: productsRes.data ?? [],
  });
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    coverImageUrl?: string | null;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    if (trimmed.length > 120) {
      return NextResponse.json({ error: 'Name is too long.' }, { status: 400 });
    }
    updates.name = trimmed;
  }
  if (body.coverImageUrl !== undefined) {
    updates.cover_image_url = body.coverImageUrl?.trim() || null;
  }

  // Cast for the dynamic updates payload — see /items/route.ts for
  // the same pattern; Supabase's generated row type doesn't accept
  // a partial Record<string, unknown> shape.
  const client = supabase as unknown as SupabaseClient;
  const res = await client
    .from('vision_boards')
    .update(updates)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (res.error) {
    console.error('vision_board update failed', res.error);
    return NextResponse.json({ error: 'Could not update board.' }, { status: 500 });
  }
  if (!res.data) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await ctx.params;
  const res = await supabase.from('vision_boards').delete().eq('id', id);
  if (res.error) {
    console.error('vision_board delete failed', res.error);
    return NextResponse.json({ error: 'Could not delete board.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
