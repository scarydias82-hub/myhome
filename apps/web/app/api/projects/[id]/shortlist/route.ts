// POST   /api/projects/[id]/shortlist  { kind, sourceId }
//   Add a render / staged image / product to the project's shortlist. Side
//   effect: if project is still 'in_progress', flip it to 'in_review' on
//   first promotion.
// DELETE /api/projects/[id]/shortlist?itemId=...
//   Remove a shortlist item.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface PostBody {
  kind?: 'render' | 'staged' | 'product';
  sourceId?: string;
  notes?: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
  status: string;
}

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

  const body = (await request.json().catch(() => ({}))) as PostBody;
  if (!body.kind || !body.sourceId) {
    return NextResponse.json({ error: 'Missing kind or sourceId.' }, { status: 400 });
  }
  if (!['render', 'staged', 'product'].includes(body.kind)) {
    return NextResponse.json({ error: 'Invalid kind.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Project must belong to the caller.
  const projectRes = await admin
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .single();
  const project = projectRes.data as ProjectRow | null;
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // Build the insert row — exactly one of render_id / staged_image_id /
  // product_id is set based on `kind`.
  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    project_id: projectId,
    kind: body.kind,
    notes: body.notes ?? null,
  };
  if (body.kind === 'render') insertRow.render_id = body.sourceId;
  if (body.kind === 'staged') insertRow.staged_image_id = body.sourceId;
  if (body.kind === 'product') insertRow.product_id = body.sourceId;

  const insertRes = await admin
    .from('shortlist_items')
    .insert(insertRow)
    .select('id')
    .single();

  // Friendly handling of the unique-index collision: row already shortlisted.
  if (insertRes.error) {
    if ((insertRes.error as { code?: string }).code === '23505') {
      return NextResponse.json({ alreadyShortlisted: true }, { status: 200 });
    }
    console.error('shortlist insert failed', insertRes.error);
    return NextResponse.json({ error: 'Could not add to shortlist.' }, { status: 500 });
  }

  // On first promotion, move the project into Review.
  if (project.status === 'in_progress') {
    await admin.from('projects').update({ status: 'in_review' }).eq('id', projectId);
  }

  return NextResponse.json({ id: (insertRes.data as { id: string }).id });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const itemId = request.nextUrl.searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  await admin
    .from('shortlist_items')
    .delete()
    .eq('id', itemId)
    .eq('project_id', projectId)
    .eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
