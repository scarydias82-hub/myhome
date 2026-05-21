// Vision board item — delete a single item from a board.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string; itemId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: boardId, itemId } = await ctx.params;
  const res = await supabase
    .from('vision_board_items')
    .delete()
    .eq('id', itemId)
    .eq('board_id', boardId);

  if (res.error) {
    console.error('vision_board_item delete failed', res.error);
    return NextResponse.json({ error: 'Could not remove item.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
