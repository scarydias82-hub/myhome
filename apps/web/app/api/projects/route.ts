// POST /api/projects — create a project. Optionally seeded from a
// vision board (Phase 3, #136) — when visionBoardId is supplied:
//   1. We persist source_board_id on the new project for traceability
//   2. We pre-fill projects.brief with a seed payload derived from the
//      board's items so the brief synthesiser has a head-start when
//      the user opens the wizard
//
// GET /api/projects — list user's projects (also available via direct
// table read in server pages).

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface BoardItemRow {
  item_type: 'palette' | 'trend' | 'product' | 'note';
  palette_id: string | null;
  trend_card_id: string | null;
  product_id: string | null;
  payload: Record<string, unknown> | null;
}

interface TrendRow {
  id: string;
  palette_id: string;
  room_type: string;
}

interface ProductRow {
  id: string;
  category: string;
  style_tags: string[] | null;
  palette_tags: string[] | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    visionBoardId?: string;
  };
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

  // §6.11 Phase B (#154): snapshot the user's canonical preferences
  // into the project's brief at create time. New projects start with
  // the user's taste signal pre-selected; subsequent edits to the
  // brief don't touch users.preferences. Cast through `any` until
  // gen-types includes the preferences column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefsRes = await (admin as any)
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();
  const userPrefTags: string[] = Array.isArray(prefsRes.data?.preferences?.tags)
    ? prefsRes.data.preferences.tags.filter((t: unknown): t is string => typeof t === 'string')
    : [];

  // If a visionBoardId is provided AND the user owns it, derive a
  // brief seed payload. We don't call Claude here — that's the job
  // of the project wizard's analyse step. We just pre-populate the
  // tags + reference materials so the synthesiser has signal.
  let briefSeed: Record<string, unknown> | null = null;
  let sourceBoardId: string | null = null;
  if (body.visionBoardId) {
    const boardRes = await supabase
      .from('vision_boards')
      .select('id, name')
      .eq('id', body.visionBoardId)
      .maybeSingle();
    if (boardRes.data) {
      sourceBoardId = (boardRes.data as { id: string }).id;
      const itemsRes = await supabase
        .from('vision_board_items')
        .select('item_type, palette_id, trend_card_id, product_id, payload')
        .eq('board_id', sourceBoardId);
      const items = (itemsRes.data as BoardItemRow[] | null) ?? [];
      briefSeed = await deriveBriefSeed(items, supabase);
    }
  }

  // Compose the brief that gets written at create time. Two cases:
  //   • Vision-board seed exists → start from briefSeed, overlay the
  //     user preference tags on top (board signals + user taste both
  //     present; user can refine both in the wizard).
  //   • No board → seed brief is just the user preferences (or an
  //     empty shape if the user hasn't onboarded yet).
  // In both cases we set `inherited_from_user_prefs: true` when the
  // tag list was sourced from users.preferences, so the wizard can
  // render the "Pre-filled from your preferences" banner.
  let projectBrief: Record<string, unknown> | null = null;
  if (briefSeed) {
    projectBrief = {
      ...briefSeed,
      tags: userPrefTags.length > 0 ? userPrefTags : (briefSeed.tags ?? []),
      inherited_from_user_prefs: userPrefTags.length > 0,
    };
  } else if (userPrefTags.length > 0) {
    projectBrief = {
      tags: userPrefTags,
      response: null,
      inherited_from_user_prefs: true,
      updated_at: new Date().toISOString(),
    };
  }

  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    name,
    source_board_id: sourceBoardId,
  };
  if (projectBrief) insertRow.brief = projectBrief;

  const res = await admin
    .from('projects')
    .insert(insertRow)
    .select('id')
    .single();
  const row = res.data as { id: string } | null;
  if (res.error || !row) {
    console.error('project insert failed', res.error);
    return NextResponse.json({ error: 'Could not create project.' }, { status: 500 });
  }
  return NextResponse.json({ id: row.id, sourceBoardId });
}

// Convert a board's items into a brief seed payload. The shape
// matches what the brief synthesiser expects to find in
// projects.brief — it carries:
//   • palette_preferences: palette slugs the user has already
//                          saved, ranked by frequency
//   • trend_signals: room_type + palette_id pairs that signal what
//                    the user is dreaming of
//   • product_anchors: product UUIDs the user has marked as
//                      must-haves
//   • notes: concatenated free-text notes from the board
//   • source: 'vision_board' + the original board id for audit
function deriveBriefSeed(
  items: BoardItemRow[],
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Record<string, unknown>> {
  return (async () => {
    const palette_preferences = items
      .filter((i) => i.item_type === 'palette' && i.palette_id)
      .map((i) => i.palette_id as string);

    const productIds = items
      .filter((i) => i.item_type === 'product' && i.product_id)
      .map((i) => i.product_id as string);
    const trendCardIds = items
      .filter((i) => i.item_type === 'trend' && i.trend_card_id)
      .map((i) => i.trend_card_id as string);

    const notes = items
      .filter((i) => i.item_type === 'note')
      .map((i) => (i.payload?.body as string | undefined) ?? '')
      .filter((s) => s.length > 0);

    // Hydrate the trend cards and products so we can extract their
    // style + palette signals. These signals are what the brief
    // synthesiser actually uses (the IDs are useful for audit).
    const [trendRows, productRows] = await Promise.all([
      trendCardIds.length > 0
        ? supabase
            .from('trend_cards')
            .select('id, palette_id, room_type')
            .in('id', trendCardIds)
        : Promise.resolve({ data: [] as TrendRow[] }),
      productIds.length > 0
        ? supabase
            .from('products')
            .select('id, category, style_tags, palette_tags')
            .in('id', productIds)
        : Promise.resolve({ data: [] as ProductRow[] }),
    ]);

    const trends = (trendRows.data as TrendRow[] | null) ?? [];
    const products = (productRows.data as ProductRow[] | null) ?? [];

    // Combine palette signals: explicit palette saves + trend palette
    // tags + product palette_tags. Frequency-ranked.
    const paletteFreq = new Map<string, number>();
    for (const id of palette_preferences) {
      paletteFreq.set(id, (paletteFreq.get(id) ?? 0) + 2); // explicit save weighs more
    }
    for (const t of trends) {
      paletteFreq.set(t.palette_id, (paletteFreq.get(t.palette_id) ?? 0) + 1);
    }
    for (const p of products) {
      for (const ptag of p.palette_tags ?? []) {
        paletteFreq.set(ptag, (paletteFreq.get(ptag) ?? 0) + 1);
      }
    }
    const palette_signal = Array.from(paletteFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    // Style tag distribution from saved products — the wizard's tag
    // picker can pre-select these.
    const styleTagFreq = new Map<string, number>();
    for (const p of products) {
      for (const t of p.style_tags ?? []) {
        styleTagFreq.set(t, (styleTagFreq.get(t) ?? 0) + 1);
      }
    }
    const style_signal = Array.from(styleTagFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);

    return {
      // Shape matches what the brief synthesiser reads in
      // lib/brief/synthesiser.ts. Keeping these as snake_case so
      // they survive JSON serialisation unchanged.
      source: 'vision_board',
      source_board_id: items.length > 0 ? 'pending' : null,
      palette_preferences,
      palette_signal,
      style_signal,
      trend_signals: trends.map((t) => ({ palette_id: t.palette_id, room_type: t.room_type })),
      product_anchors: productIds,
      notes: notes.join('\n\n'),
      // Empty stubs so the synthesiser can fill them after Claude runs
      tags: [],
      avoid: [],
      recommendation: null,
    };
  })();
}
