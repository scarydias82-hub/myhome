// Vision boards — list (GET) and create (POST).
//
// GET  /api/vision-boards         — list user's boards, ordered by recency
// POST /api/vision-boards         — create a board { name }

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // RLS scopes vision_boards to the owner, so the standard client is
  // safe — no admin needed here.
  const res = await supabase
    .from('vision_boards')
    .select('id, name, cover_image_url, item_count, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (res.error) {
    console.error('vision_boards list failed', res.error);
    return NextResponse.json({ error: 'Could not load boards.' }, { status: 500 });
  }

  return NextResponse.json({ boards: res.data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    coverImageUrl?: string;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  if (name.length > 120) {
    return NextResponse.json({ error: 'Name is too long (120 chars max).' }, { status: 400 });
  }

  // public.users mirror upsert mirrors the projects route — guard
  // against the auth.users vs public.users drift that occasionally
  // surfaces with fresh sign-ups.
  const admin = createAdminClient() as unknown as SupabaseClient;
  await admin
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id' });

  const res = await admin
    .from('vision_boards')
    .insert({
      user_id: user.id,
      name,
      cover_image_url: body.coverImageUrl?.trim() || null,
    })
    .select('id')
    .single();

  const row = res.data as { id: string } | null;
  if (res.error || !row) {
    console.error('vision_board insert failed', res.error);
    return NextResponse.json({ error: 'Could not create board.' }, { status: 500 });
  }
  return NextResponse.json({ id: row.id });
}
