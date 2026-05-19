// POST /api/projects/[id]/complete — flip status to 'completed'.
// POST /api/projects/[id]/complete with {undo: true} — flip back to 'in_review'.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { undo?: boolean };
  const targetStatus = body.undo ? 'in_review' : 'completed';

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Verify ownership.
  const projectRes = await admin
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .single();
  const project = projectRes.data as { id: string; user_id: string; status: string } | null;
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  await admin.from('projects').update({ status: targetStatus }).eq('id', projectId);
  return NextResponse.json({ status: targetStatus });
}
