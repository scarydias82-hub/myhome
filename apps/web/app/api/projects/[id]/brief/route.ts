// /api/projects/[id]/brief
//
// GET  → returns the stored brief for the project: { tags, response, updated_at }
// POST { tags: string[] } → validates tags against the known taxonomy,
//        runs the synthesiser, persists tags + response on projects.brief,
//        and returns the synthesis to the caller.
//
// projects.brief is a JSONB column (existing schema from
// 20260518150000_projects.sql) — we shape it as:
//   { tags: string[], response: BriefSynthesis, updated_at: string }
// so the entire brief lives in one column without a schema change.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { filterKnownTags } from '@/lib/brief/taxonomy';
import { synthesiseBrief, type BriefSynthesis } from '@/lib/brief/synthesiser';

export const runtime = 'nodejs';
// Claude Sonnet at temperature 0.6 with our 65-tag taxonomy in the
// system prompt typically returns in ~6-10s. 60s ceiling keeps room
// for the retry-with-backoff path.
export const maxDuration = 60;

interface StoredBrief {
  tags: string[];
  response: BriefSynthesis | null;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
  brief: StoredBrief | null;
}

interface PostBody {
  tags?: string[];
}

async function loadProject(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  const { data, error } = await admin
    .from('projects')
    .select('id, user_id, brief')
    .eq('id', projectId)
    .single();
  if (error || !data) return null;
  const row = data as ProjectRow;
  if (row.user_id !== userId) return null;
  return row;
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const project = await loadProject(admin, user.id, id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  return NextResponse.json({
    tags: project.brief?.tags ?? [],
    response: project.brief?.response ?? null,
    updated_at: project.brief?.updated_at ?? null,
  });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const project = await loadProject(admin, user.id, id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const tags = filterKnownTags(body.tags ?? []);
  if (tags.length === 0) {
    return NextResponse.json(
      { error: 'Pick at least one tag before asking the designer.' },
      { status: 400 },
    );
  }

  let response: BriefSynthesis;
  try {
    response = await synthesiseBrief(tags);
  } catch (err) {
    console.error('[brief] synthesise failed', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Designer call failed.',
      },
      { status: 502 },
    );
  }

  const stored: StoredBrief = {
    tags,
    response,
    updated_at: new Date().toISOString(),
  };
  const { error: updateErr } = await admin
    .from('projects')
    .update({ brief: stored, updated_at: stored.updated_at })
    .eq('id', project.id);
  if (updateErr) {
    console.error('[brief] persist failed', updateErr);
    // Still return the synthesis — the user gets value, we'll log to
    // diagnose the persistence break separately.
  }

  return NextResponse.json(stored);
}
