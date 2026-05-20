// /api/wishlist
//
// GET           → { items: string[] }    — productIds the current user has saved
// POST { productId, action: 'save' | 'remove' }
//               → { saved: boolean }
//
// Backs the heart-icon Save button on every picking-list match card.
// Saves are per-user, room/project independent — they sit in front of
// the project-shortlist commitment flow (project lifecycle) so the user
// can bank options across multiple renders before deciding which
// project a piece belongs to.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface ToggleBody {
  productId?: string;
  action?: 'save' | 'remove';
}

export async function GET() {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('user_wishlist')
    .select('product_id')
    .order('saved_at', { ascending: false });
  if (error) {
    // Table may not exist yet if the 20260520140000 migration hasn't
    // been applied. Return empty so the UI continues to render.
    console.warn('[wishlist] list failed', error);
    return NextResponse.json({ items: [] });
  }
  return NextResponse.json({
    items: (data ?? []).map((row) => (row as { product_id: string }).product_id),
  });
}

export async function POST(request: NextRequest) {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ToggleBody;
  const productId = body.productId;
  const action = body.action ?? 'save';
  if (!productId || typeof productId !== 'string') {
    return NextResponse.json({ error: 'Missing productId' }, { status: 400 });
  }

  if (action === 'remove') {
    const { error } = await supabase
      .from('user_wishlist')
      .delete()
      .eq('user_id', user.id)
      .eq('product_id', productId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ saved: false });
  }

  // Default: save (upsert so calling twice is idempotent).
  const { error } = await supabase
    .from('user_wishlist')
    .upsert(
      { user_id: user.id, product_id: productId },
      { onConflict: 'user_id,product_id' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true });
}
