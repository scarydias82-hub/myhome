// POST /api/render
//
// Body: { roomId, style, paletteId?, featuredProductIds?, projectId? }
//
// Async pipeline (post-refactor):
//   1. Verify room + create style_profile + renders row (status='running')
//   2. Submit Flux job to fal queue → store fal_request_id
//   3. Return { id } immediately
//
// The /renders/[id] page then polls /api/renders/[id]/status which checks
// fal's queue, finalises the render (download + storage + picking list) once
// fal reports completed, and updates the renders row.

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
import { submitDepthRender } from '@/lib/fal';
import { getPalette } from '@/lib/palettes';

export const runtime = 'nodejs';
// Submit is a fast call — generous budget but typical run is <8s now.
export const maxDuration = 30;

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

  const roomRes = await admin
    .from('rooms')
    .select('id, user_id, photo_url, analysis')
    .eq('id', body.roomId)
    .single();
  const room = roomRes.data as RoomRow | null;
  if (!room || room.user_id !== user.id) {
    return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
  }

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

  const signed = await admin.storage.from('rooms').createSignedUrl(room.photo_url, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    return NextResponse.json({ error: 'Could not sign photo URL.' }, { status: 500 });
  }

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
    const groundedPrompt = buildPrompt(
      style,
      room.analysis as RoomFacts | null,
      heroProducts.length > 0 ? heroProducts : null,
    );
    const submission = await submitDepthRender({
      prompt: groundedPrompt,
      controlImageUrl: signed.data.signedUrl,
    });
    await admin
      .from('renders')
      .update({ fal_request_id: submission.requestId })
      .eq('id', render.id);
  } catch (err) {
    console.error('fal submit failed', err);
    await admin
      .from('renders')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', render.id);
    const e = err as { body?: { detail?: string }; message?: string };
    const detail = e?.body?.detail ?? e?.message ?? 'Could not submit render job.';
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  return NextResponse.json({ id: render.id });
}
