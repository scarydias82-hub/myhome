// POST /api/render
//
// Body: { roomId: string, style: StyleSlug, paletteId?: string }
//
// Pre-condition: /api/analyse-room must have run first to create the room
// and store its vision analysis. We use that analysis to ground the Flux
// prompt — the M2 fidelity fix at the source.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getStyle,
  buildPrompt,
  type RoomFacts,
  type HeroProductDescriptor,
} from '@/lib/styles';
import { renderWithDepth } from '@/lib/fal';
import { buildPickingList } from '@/lib/matching';
import { getPalette } from '@/lib/palettes';

export const runtime = 'nodejs';
// M2 adds ~10-15s for detection + crop embedding + matching, on top of
// ~20-30s of Flux rendering. Bumping the budget so Vercel doesn't cut us off.
export const maxDuration = 120;

interface Body {
  roomId?: string;
  style?: string;
  paletteId?: string;
  featuredProductIds?: string[];
  projectId?: string;
}

interface RoomRow {
  id: string;
  user_id: string;
  photo_url: string;
  analysis: (RoomFacts & Record<string, unknown>) | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId || !body.style) {
    return NextResponse.json({ error: 'Missing roomId or style.' }, { status: 400 });
  }
  const style = getStyle(body.style);
  if (!style) {
    return NextResponse.json({ error: `Unknown style: ${body.style}` }, { status: 400 });
  }
  const palette = body.paletteId ? getPalette(body.paletteId) ?? null : null;

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Load the room and verify ownership.
  const roomRes = await admin
    .from('rooms')
    .select('id, user_id, photo_url, analysis')
    .eq('id', body.roomId)
    .single();
  const room = roomRes.data as RoomRow | null;
  if (!room || room.user_id !== user.id) {
    return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
  }

  // Style profile lives per-render so that future user-edited palettes can
  // diverge from the hardcoded preset.
  const profileRes = await admin
    .from('style_profiles')
    .insert({
      user_id: user.id,
      source: 'hardcoded',
      source_ref: style.slug,
      style_descriptor: style.descriptor,
      palette: palette ? palette.colors.map((c) => c.hex) : style.palette,
      materials: style.materials,
      mood: style.mood,
    })
    .select('id')
    .single();
  const profile = profileRes.data as { id: string } | null;
  if (profileRes.error || !profile) {
    console.error('style_profile insert failed', profileRes.error);
    return NextResponse.json({ error: 'Could not create style profile.' }, { status: 500 });
  }

  // Verify project ownership before linking. Body's projectId wins over the
  // room's stored project_id if both are present (the user may be linking an
  // existing room into a project at render time).
  let verifiedProjectId: string | null = null;
  const candidateProjectId = body.projectId ?? null;
  if (candidateProjectId) {
    const pRes = await admin
      .from('projects')
      .select('id, user_id')
      .eq('id', candidateProjectId)
      .single();
    const p = pRes.data as { id: string; user_id: string } | null;
    if (p && p.user_id === user.id) verifiedProjectId = p.id;
  }

  const renderRes = await admin
    .from('renders')
    .insert({
      user_id: user.id,
      room_id: room.id,
      style_profile_id: profile.id,
      status: 'running',
      project_id: verifiedProjectId,
    })
    .select('id')
    .single();
  const render = renderRes.data as { id: string } | null;
  if (renderRes.error || !render) {
    console.error('render insert failed', renderRes.error);
    return NextResponse.json({ error: 'Could not create render record.' }, { status: 500 });
  }

  const signed = await admin.storage.from('rooms').createSignedUrl(room.photo_url, 60 * 10);
  if (signed.error || !signed.data?.signedUrl) {
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    return NextResponse.json({ error: 'Could not sign photo URL.' }, { status: 500 });
  }

  // Optional hero products to weave into the Flux prompt.
  let heroProducts: HeroProductDescriptor[] = [];
  if (body.featuredProductIds && body.featuredProductIds.length > 0) {
    const ids = body.featuredProductIds.slice(0, 3);
    const { data } = await admin
      .from('products')
      .select('name, category, retailer')
      .in('id', ids);
    if (data) heroProducts = data as HeroProductDescriptor[];
  }

  try {
    // Vision-grounded prompt — falls back gracefully if analysis is missing.
    const groundedPrompt = buildPrompt(
      style,
      room.analysis as RoomFacts | null,
      heroProducts.length > 0 ? heroProducts : null,
    );

    const output = await renderWithDepth({
      prompt: groundedPrompt,
      controlImageUrl: signed.data.signedUrl,
    });

    const outKey = `${user.id}/${render.id}.webp`;

    const uploadTask = (async () => {
      const bytes = new Uint8Array(await (await fetch(output.imageUrl)).arrayBuffer());
      return admin.storage.from('renders').upload(outKey, bytes, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true,
      });
    })();

    const matchTask = buildPickingList({
      admin,
      renderImageUrl: output.imageUrl,
    }).catch((err) => {
      console.error('picking list build failed', err);
      return { items: [] as unknown[], imageWidth: 0, imageHeight: 0 };
    });

    const [uploadRes, matchRes] = await Promise.all([uploadTask, matchTask]);
    if (uploadRes.error) throw new Error(uploadRes.error.message);
    const pickingList = matchRes.items;

    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        picking_list: pickingList,
        cost_estimate_aud: estimateTotal(pickingList),
        completed_at: new Date().toISOString(),
      })
      .eq('id', render.id);
  } catch (err) {
    console.error('render pipeline failed', err);
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    const e = err as { body?: { detail?: string }; message?: string };
    const detail = e?.body?.detail ?? e?.message ?? 'Render failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  return NextResponse.json({ id: render.id });
}

// Sum the cheapest priced match for each item — gives a baseline "you could
// style this room from $X" figure. POA matches are skipped from the total.
function estimateTotal(items: unknown[]): number | null {
  let total = 0;
  let counted = 0;
  for (const raw of items) {
    const item = raw as { matches?: Array<{ priceAud: number | null }> };
    const cheapest = (item.matches ?? [])
      .map((m) => m.priceAud)
      .filter((p): p is number => typeof p === 'number' && p > 0)
      .sort((a, b) => a - b)[0];
    if (cheapest != null) {
      total += cheapest;
      counted++;
    }
  }
  return counted > 0 ? Math.round(total) : null;
}
