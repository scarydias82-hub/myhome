// POST /api/stage-multi
//
// Body: { renderId, items: [{ itemIndex, productId }] }
//
// Composites several catalogue products into the user's original room photo
// in ONE Flux Pro Fill call — saves N-1 fal credits compared to N single
// /api/stage calls. Persists one staged_images row with the full
// product_ids array so the shortlist + cost rollup know every item placed.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stageMultipleProducts, type MultiStageItem } from '@/lib/staging';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PostBody {
  renderId?: string;
  items?: Array<{ itemIndex: number; productId: string }>;
}

interface RenderRow {
  id: string;
  user_id: string;
  room_id: string;
  project_id: string | null;
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

const MAX_ITEMS = 4;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as PostBody;
  if (!body.renderId || !body.items || body.items.length === 0) {
    return NextResponse.json(
      { error: 'Missing renderId or empty items array.' },
      { status: 400 },
    );
  }
  if (body.items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Pick up to ${MAX_ITEMS} products per multi-stage.` },
      { status: 400 },
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  const renderRes = await admin
    .from('renders')
    .select('id, user_id, room_id, project_id, picking_list')
    .eq('id', body.renderId)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found.' }, { status: 404 });
  }

  // Validate every item and resolve its bbox.
  const itemSpecs: Array<{
    itemIndex: number;
    productId: string;
    bbox: { x: number; y: number; w: number; h: number };
  }> = [];
  for (const spec of body.items) {
    const pl = render.picking_list?.[spec.itemIndex];
    if (!pl) {
      return NextResponse.json(
        { error: `Item index ${spec.itemIndex} not in picking list.` },
        { status: 400 },
      );
    }
    itemSpecs.push({ itemIndex: spec.itemIndex, productId: spec.productId, bbox: pl.bbox });
  }

  // Load products in one query.
  const productIds = itemSpecs.map((s) => s.productId);
  const productsRes = await admin
    .from('products')
    .select('id, name, retailer, category, image_url, colors, materials')
    .in('id', productIds);
  const products = (productsRes.data as ProductRow[] | null) ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const roomRes = await admin
    .from('rooms')
    .select('photo_url')
    .eq('id', render.room_id)
    .single();
  const room = roomRes.data as RoomRow | null;
  if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });

  const stagingItems: MultiStageItem[] = [];
  for (const spec of itemSpecs) {
    const p = productById.get(spec.productId);
    if (!p) continue;
    stagingItems.push({
      productId: spec.productId,
      bbox: spec.bbox,
      product: {
        name: p.name,
        category: p.category,
        retailer: p.retailer,
        imageUrl: p.image_url ?? null,
        colors: p.colors ?? [],
        materials: p.materials ?? [],
      },
    });
  }

  if (stagingItems.length === 0) {
    return NextResponse.json({ error: 'No valid products to stage.' }, { status: 400 });
  }

  try {
    const result = await stageMultipleProducts({
      admin,
      userId: user.id,
      roomPhotoKey: room.photo_url,
      renderId: render.id,
      projectId: render.project_id,
      items: stagingItems,
    });
    return NextResponse.json({
      imageUrl: result.imageUrl,
      prompt: result.prompt,
      stagedImageId: result.stagedImageId,
    });
  } catch (err) {
    const e = err as {
      body?: { detail?: unknown };
      message?: string;
      status?: number;
    };
    const detailJson = e?.body?.detail ? JSON.stringify(e.body.detail).slice(0, 600) : null;
    console.error(
      `multi-stage failed status=${e?.status ?? '?'} message=${e?.message ?? '?'} detail=${detailJson ?? '?'}`,
    );
    const summary =
      (typeof e?.body?.detail === 'string' ? e.body.detail : null) ??
      detailJson ??
      e?.message ??
      'Multi-stage failed';
    return NextResponse.json({ error: summary }, { status: 500 });
  }
}
