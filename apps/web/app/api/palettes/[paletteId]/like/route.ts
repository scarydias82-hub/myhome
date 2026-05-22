// POST /api/palettes/[paletteId]/like
//
// Toggles the current user's like on a palette. If the user hasn't liked
// the palette yet, inserts a row; if they have, deletes it. Returns the
// new liked state + the updated aggregate count so the client can update
// optimistically without a refetch.
//
// Validates that paletteId is a known palette slug so we don't accumulate
// phantom likes for IDs that no longer exist in the catalogue.
//
// NOTE: palette_likes is a recent migration not yet reflected in the
// generated Supabase types, so queries cast through `any` until the next
// `supabase gen types` run.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPalette } from '@/lib/palettes';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ paletteId: string }> },
) {
  const { paletteId } = await params;

  // Validate the palette exists in the catalogue.
  const palette = getPalette(paletteId);
  if (!palette) {
    return NextResponse.json({ error: 'Palette not found' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  // Check if the user already likes this palette.
  const { data: existing } = await supabase
    .from('palette_likes')
    .select('id')
    .eq('user_id', user.id)
    .eq('palette_id', paletteId)
    .maybeSingle();

  let liked: boolean;

  if (existing) {
    // Unlike — remove the row.
    const { error } = await supabase
      .from('palette_likes')
      .delete()
      .eq('id', (existing as { id: string }).id);
    if (error) {
      return NextResponse.json({ error: 'Failed to unlike' }, { status: 500 });
    }
    liked = false;
  } else {
    // Like — insert a new row.
    const { error } = await supabase
      .from('palette_likes')
      .insert({ user_id: user.id, palette_id: paletteId });
    if (error) {
      return NextResponse.json({ error: 'Failed to like' }, { status: 500 });
    }
    liked = true;
  }

  // Return the fresh aggregate count so the button label stays accurate.
  const { count } = await supabase
    .from('palette_likes')
    .select('id', { count: 'exact', head: true })
    .eq('palette_id', paletteId);

  return NextResponse.json({ liked, totalCount: count ?? 0 });
}
