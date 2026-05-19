// PATCH /api/renders/[id]/revisions
// Body: { revisionId: string }
//
// Sets renders.active_revision_id to the chosen revision. Used by the
// revision strip on /renders/[id] when the user clicks a past revision
// to revert or roll forward. No fal calls — pure pointer flip, instant.
//
// GET /api/renders/[id]/revisions
// Returns the revision list (with signed thumbnail URLs) for client-side
// rendering if ever needed. Page currently fetches them server-side
// inside /renders/[id]/page.tsx, but this endpoint is here for future
// client refresh scenarios.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listRevisions } from '@/lib/revisions';

export const runtime = 'nodejs';

interface PatchBody {
  revisionId?: string;
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: renderId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  if (!body.revisionId) {
    return NextResponse.json({ error: 'Missing revisionId.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Verify the render belongs to this user.
  const renderRes = await admin
    .from('renders')
    .select('id, user_id')
    .eq('id', renderId)
    .single();
  const render = renderRes.data as { id: string; user_id: string } | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found.' }, { status: 404 });
  }

  // Verify the revision belongs to this render. RLS would catch
  // cross-user reads, but we still want to fail loudly here if the
  // client sent a revision id from a different render.
  const revRes = await admin
    .from('render_revisions')
    .select('id, render_id, user_id')
    .eq('id', body.revisionId)
    .single();
  const revision = revRes.data as {
    id: string;
    render_id: string;
    user_id: string;
  } | null;
  if (!revision || revision.render_id !== renderId || revision.user_id !== user.id) {
    return NextResponse.json({ error: 'Revision not found.' }, { status: 404 });
  }

  const updateRes = await admin
    .from('renders')
    .update({ active_revision_id: body.revisionId })
    .eq('id', renderId);
  if (updateRes.error) {
    console.error('[revisions PATCH] update failed', updateRes.error);
    return NextResponse.json({ error: 'Could not set active revision.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activeRevisionId: body.revisionId });
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: renderId } = await ctx.params;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const renderRes = await admin
    .from('renders')
    .select('user_id, active_revision_id')
    .eq('id', renderId)
    .single();
  const render = renderRes.data as {
    user_id: string;
    active_revision_id: string | null;
  } | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found.' }, { status: 404 });
  }

  const revisions = await listRevisions({ admin, renderId });
  // Sign thumbnail URLs server-side so the client doesn't need
  // service-role access.
  const signed = await Promise.all(
    revisions.map(async (r) => {
      const sig = await admin.storage
        .from(r.image_bucket)
        .createSignedUrl(r.image_path, 60 * 60);
      return {
        id: r.id,
        kind: r.kind,
        label: r.label,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        imageUrl: sig.data?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json({
    activeRevisionId: render.active_revision_id,
    revisions: signed,
  });
}
