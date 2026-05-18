// POST /api/projects — create a project.
// GET  /api/projects — list user's projects (also available via direct table read in server pages).

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  if (name.length > 120) {
    return NextResponse.json({ error: 'Name is too long (120 chars max).' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Same upsert dance we do in the render route — public.users mirror is
  // occasionally out of sync.
  await admin
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id' });

  const res = await admin
    .from('projects')
    .insert({ user_id: user.id, name })
    .select('id')
    .single();
  const row = res.data as { id: string } | null;
  if (res.error || !row) {
    console.error('project insert failed', res.error);
    return NextResponse.json({ error: 'Could not create project.' }, { status: 500 });
  }
  return NextResponse.json({ id: row.id });
}
