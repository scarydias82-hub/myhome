// GET /api/projects/active
//
// Returns the user's active projects (status in 'in_progress' or
// 'in_review'). Completed + archived projects are excluded — the
// AddToProjectButton uses this list as its "which project to add
// to" picker and won't show projects that are already locked in
// (#130).
//
// Lightweight response — just id + name + status — so the picker
// modal can open instantly without further fetches.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status')
    .in('status', ['in_progress', 'in_review'])
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[projects/active] fetch failed', error.message);
    return NextResponse.json({ projects: [] });
  }

  return NextResponse.json({
    projects: (data as { id: string; name: string; status: string }[]) ?? [],
  });
}
