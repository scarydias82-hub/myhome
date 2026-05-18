// POST /api/stage
//
// Body: { renderId: string, itemIndex: number, productId: string }
//
// Composite the chosen product into the user's ORIGINAL room photo at the
// position the picking list detected for that item. Returns the composite
// image URL. Caller renders it in the staging modal.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stageProduct } from '@/lib/staging';

export const runtime = 'nodejs';
// fal inpaint typically returns in 15-25s; bump headroom.
export const maxDuration = 60;

interface Body {
  renderId?: string;
  itemIndex?: number;
  productId?: string;
}

interface RenderRow {
  id: string;
  user_id: string;
  room_id: string;
  picking_list: Array<{
    itemLabel: string;
    category: string;
    bbox: { x: number; y: number; w: number; h: number };
    matches?: Array<{ productId: string }>;
  }> | null;
}

interface RoomRow {
  photo_url: string;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  image_url: string;
  colors: string[] | null;
  materials: string[] | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.renderId || typeof body.itemIndex !== 'number' || !body.productId) {
    return NextResponse.json(
      { error: 'Missing renderId, itemIndex, or productId.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  const renderRes = await admin
    .from('renders')
    .select('id, user_id, room_id, picking_list')
    .eq('id', body.renderId)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found.' }, { status: 404 });
  }
  const item = render.picking_list?.[body.itemIndex];
  if (!item) {
    return NextResponse.json({ error: 'Item not in picking list.' }, { status: 400 });
  }

  const roomRes = await admin
    .from('rooms')
    .select('photo_url')
    .eq('id', render.room_id)
    .single();
  const room = roomRes.data as RoomRow | null;
  if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });

  const productRes = await admin
    .from('products')
    .select('id, name, retailer, category, image_url, colors, materials')
    .eq('id', body.productId)
    .single();
  const product = productRes.data as ProductRow | null;
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

  try {
    const result = await stageProduct({
      admin,
      userId: user.id,
      roomPhotoKey: room.photo_url,
      bbox: item.bbox,
      product: {
        name: product.name,
        category: product.category,
        retailer: product.retailer,
        imageUrl: product.image_url,
        colors: product.colors ?? [],
        materials: product.materials ?? [],
      },
    });
    return NextResponse.json({ imageUrl: result.imageUrl, prompt: result.prompt });
  } catch (err) {
    // fal validation errors carry .body.detail as an array of {loc,msg,type}.
    // Stringify the whole thing so the next 422 is debuggable from logs.
    const e = err as {
      body?: { detail?: unknown };
      message?: string;
      status?: number;
    };
    const detailJson = e?.body?.detail ? JSON.stringify(e.body.detail).slice(0, 600) : null;
    console.error(
      `staging failed status=${e?.status ?? '?'} message=${e?.message ?? '?'} detail=${detailJson ?? '?'}`,
    );
    const summary =
      (typeof e?.body?.detail === 'string' ? e.body.detail : null) ??
      detailJson ??
      e?.message ??
      'Staging failed';
    return NextResponse.json({ error: summary }, { status: 500 });
  }
}
