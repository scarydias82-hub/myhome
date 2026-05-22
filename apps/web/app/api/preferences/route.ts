// GET / PUT /api/preferences — canonical user-level taste signal (§6.11
// Phase A, #153).
//
// Reads + writes `users.preferences` (jsonb) for the authenticated user.
// This is the ONLY write surface for canonical preferences — project
// briefs and per-render overrides snapshot from it but never mutate it.
// Editing happens via the dashboard "My Preferences" section, which
// posts here.
//
// Shape mirrors project.brief:
//   {
//     "tags": ["modern-organic", "warm-grounded-earth", ...],
//     "updated_at": "<iso8601>"
//   }

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export interface UserPreferences {
  tags: string[];
  updated_at: string;
}

function isValidPreferencesBody(body: unknown): body is { tags: string[] } {
  if (!body || typeof body !== 'object') return false;
  const tags = (body as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return false;
  return tags.every((t) => typeof t === 'string' && t.length > 0 && t.length < 80);
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // users.preferences is a recent migration not yet in the generated
  // Supabase types — same pattern as palette_likes earlier. Cast
  // through `any` until the next `supabase gen types` run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error('[preferences GET] failed', error);
    return NextResponse.json({ error: 'Could not read preferences.' }, { status: 500 });
  }

  // null when the user hasn't onboarded yet — client treats this as
  // "show the onboarding modal".
  const preferences = (data?.preferences as UserPreferences | null) ?? null;
  return NextResponse.json({ preferences });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!isValidPreferencesBody(body)) {
    return NextResponse.json(
      { error: 'Body must be { tags: string[] } with non-empty string tags.' },
      { status: 400 },
    );
  }

  // De-dup + sort so the stored shape is stable.
  const cleanTags = [...new Set(body.tags)].sort();

  const preferences: UserPreferences = {
    tags: cleanTags,
    updated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('users')
    .update({ preferences })
    .eq('id', user.id);
  if (error) {
    console.error('[preferences PUT] failed', error);
    return NextResponse.json({ error: 'Could not save preferences.' }, { status: 500 });
  }

  return NextResponse.json({ preferences });
}
