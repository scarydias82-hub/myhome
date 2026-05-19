// Render revision history helpers. Called by /api/stage and
// /api/stage-multi after a successful Flux Pro Fill, and by
// /api/renders/[id]/revisions when the user clicks a past revision in
// the strip.
//
// Each successful staging creates a new revision row pointing at the
// composite that already lives in the renders bucket, and updates
// renders.active_revision_id so the render page picks it up. The
// original Flux output was backfilled into its own revision by the
// 20260520 migration.

import type { SupabaseClient } from '@supabase/supabase-js';

export type RevisionKind = 'original' | 'staged' | 'multi_staged';

export interface RevisionRow {
  id: string;
  render_id: string;
  user_id: string;
  kind: RevisionKind;
  image_bucket: string;
  image_path: string;
  source_staged_image_id: string | null;
  label: string | null;
  sort_order: number;
  created_at: string;
}

// Insert a new revision and set it as the active one. Returns the
// inserted revision id (or null if the insert failed — caller logs).
//
// admin should be a service-role client. renderId + userId must match
// the render the staging came from — the API routes have already
// verified this against the authed user.
export async function appendRevision({
  admin,
  renderId,
  userId,
  kind,
  imageBucket = 'renders',
  imagePath,
  sourceStagedImageId,
  label,
}: {
  admin: SupabaseClient;
  renderId: string;
  userId: string;
  kind: RevisionKind;
  imageBucket?: string;
  imagePath: string;
  sourceStagedImageId?: string | null;
  label?: string | null;
}): Promise<string | null> {
  // Find the next sort_order for this render so the strip stays in
  // chronological order. The 'original' revision is always 0; stagings
  // get 1, 2, 3, …
  const { data: maxRow } = await admin
    .from('render_revisions')
    .select('sort_order')
    .eq('render_id', renderId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const insertRes = await admin
    .from('render_revisions')
    .insert({
      render_id: renderId,
      user_id: userId,
      kind,
      image_bucket: imageBucket,
      image_path: imagePath,
      source_staged_image_id: sourceStagedImageId ?? null,
      label: label ?? null,
      sort_order: nextSortOrder,
    })
    .select('id')
    .single();

  const revisionId = (insertRes.data as { id: string } | null)?.id ?? null;
  if (!revisionId) {
    console.error('[revisions] insert failed', insertRes.error);
    return null;
  }

  // Flip the active pointer.
  const updateRes = await admin
    .from('renders')
    .update({ active_revision_id: revisionId })
    .eq('id', renderId);
  if (updateRes.error) {
    console.error('[revisions] update active_revision_id failed', updateRes.error);
    // Revision row still exists; the strip will show it but won't be
    // active. Better than nothing.
  }

  return revisionId;
}

// List revisions for a render in display order.
export async function listRevisions({
  admin,
  renderId,
}: {
  admin: SupabaseClient;
  renderId: string;
}): Promise<RevisionRow[]> {
  const { data, error } = await admin
    .from('render_revisions')
    .select(
      'id, render_id, user_id, kind, image_bucket, image_path, source_staged_image_id, label, sort_order, created_at',
    )
    .eq('render_id', renderId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[revisions] list failed', error);
    return [];
  }
  return (data as RevisionRow[]) ?? [];
}
