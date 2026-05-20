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

import sharp from 'sharp';
import { NextResponse, type NextRequest, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getStyle,
  buildPrompt,
  type RoomFacts,
  type HeroProductDescriptor,
} from '@/lib/styles';
import { submitDepthRender, uploadImageBuffer } from '@/lib/fal';
import { getPalette } from '@/lib/palettes';
import { getDesignerAdvice } from '@/lib/designer';
import { autoFeatureForPalette } from '@/lib/featuring';
import { generatePaletteSwatch } from '@/lib/paletteSwatch';
import { trimBlackBorders } from '@/lib/imagePrep';
import type { RoomAnalysis } from '@/lib/vision';

// Compute Flux-compatible output dimensions that preserve the source
// photo's aspect ratio. Without this, /api/render never passes dims to
// submitDepthRender and the fal endpoint falls back to landscape_4_3 —
// so a portrait phone shot comes back squashed into a landscape canvas.
//
// Flux dev wants dimensions divisible by 32 and (for quality) the long
// edge near 1024. We compute the longest edge as 1024 and round each
// axis to the nearest multiple of 32 within that bound.
async function computeFluxDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  const srcW = meta.width ?? 1024;
  const srcH = meta.height ?? 768;
  const ratio = srcW / srcH;
  const long = 1024;
  let w: number;
  let h: number;
  if (ratio >= 1) {
    w = long;
    h = Math.round(long / ratio);
  } else {
    h = long;
    w = Math.round(long * ratio);
  }
  // Snap to multiples of 32. Flux refuses anything else.
  w = Math.max(512, Math.round(w / 32) * 32);
  h = Math.max(512, Math.round(h / 32) * 32);
  return { width: w, height: h };
}

export const runtime = 'nodejs';
// Submit itself is fast (~5-8s) but we now kick off the designer LLM
// via after() in the same function — that needs another 15-25s. Bump
// to 60 so the background call has comfortable headroom.
export const maxDuration = 60;

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
    // User explicitly picked products to feature.
    const ids = body.featuredProductIds.slice(0, 3);
    const { data } = await admin
      .from('products')
      .select('name, category, retailer')
      .in('id', ids);
    if (data) heroProducts = data as HeroProductDescriptor[];
  } else if (palette) {
    // Auto-feature path: user picked a palette but no specific products.
    // Pull palette-matched, room-appropriate catalogue items and name
    // them in the prompt so Flux anchors closer to real products
    // instead of inventing generic "linen bedding". Closes part of the
    // catalog-to-render gap that the picking-list step (which runs
    // post-render) couldn't address — see lib/featuring.ts.
    const roomType = (room.analysis as RoomAnalysis | null)?.room_type ?? null;
    heroProducts = await autoFeatureForPalette({
      admin,
      paletteId: palette.id,
      roomType,
      limit: 3,
    });
    if (heroProducts.length > 0) {
      console.log(
        `[render] auto-featured ${heroProducts.length} for palette=${palette.id} room=${roomType}: ` +
          heroProducts.map((p) => `${p.retailer}/${p.category}/${p.name}`).join(' · '),
      );
    }
  }

  // Kick off the designer LLM in the background. It doesn't depend on
  // the fal output — works from room analysis + selected palette +
  // catalogue candidates — so it can run during the render wait,
  // giving the user something to engage with for the 25-60s Flux pass.
  // Persists to renders.designer_read; the page reads from there.
  after(async () => {
    try {
      const advice = await getDesignerAdvice({
        admin,
        roomAnalysis: room.analysis as RoomAnalysis | null,
        palette,
      });
      await admin
        .from('renders')
        .update({ designer_read: advice })
        .eq('id', render.id);
      console.log(`[render] designer pre-read saved for ${render.id}`);
    } catch (err) {
      console.error('[render] designer pre-read failed', err);
    }
  });

  try {
    const groundedPrompt = buildPrompt(
      style,
      room.analysis as RoomFacts | null,
      heroProducts.length > 0 ? heroProducts : null,
      palette,
    );
    // Read the source photo's dimensions so Flux outputs at the same
    // aspect — portrait stays portrait, landscape stays landscape.
    // Also trim phone-screenshot letterbox bars (see lib/imagePrep.ts)
    // — if any are detected, re-upload the trimmed version to fal
    // storage and use THAT as the canny / init image so we don't lock
    // the black borders into the render.
    let dims: { width: number; height: number } | undefined;
    let controlImageUrl = signed.data.signedUrl;
    try {
      const dl = await admin.storage.from('rooms').download(room.photo_url);
      if (dl.data) {
        const rawBuf = Buffer.from(await dl.data.arrayBuffer());
        const trim = await trimBlackBorders(rawBuf);
        if (trim.trimmed && trim.before && trim.after) {
          console.log(
            `[render] trimmed letterbox: ${trim.before.width}×${trim.before.height} → ${trim.after.width}×${trim.after.height}`,
          );
          // Re-upload the trimmed photo to fal storage so the URL we
          // give Flux points at clean room pixels, not bordered ones.
          try {
            controlImageUrl = await uploadImageBuffer(
              trim.buf,
              `room-${render.id}-trimmed.jpg`,
              'image/jpeg',
            );
          } catch (err) {
            console.warn('[render] trimmed re-upload failed, using original URL', err);
          }
        }
        dims = await computeFluxDimensions(trim.buf);
      }
    } catch (err) {
      console.warn('[render] could not read photo dimensions, using default', err);
    }
    // IP-Adapter palette swatch is OPT-IN via FLUX_ENABLE_IP_ADAPTER
    // env var. Default: OFF in production. Reason: round 11 production
    // render returned fal status 422 with body
    //   "Could not load pipeline due to error: The size of tensor a
    //    (32) must match the size of tensor b (1056)"
    // — the InstantX/FLUX.1-dev-IP-Adapter + SigLIP encoder combo
    // we're sending fails to compose at fal's runtime even though
    // InstantX's HF docs say they should. The eval may have only
    // succeeded because the fal worker had a cached pipeline from an
    // earlier request and didn't re-load. Until we have a known-good
    // IP-Adapter/encoder combo on fal, production stays text-only
    // (round-5 baseline, ~4.5/10 — shippable). The eval can still
    // experiment by setting FLUX_ENABLE_IP_ADAPTER=1 in its env.
    let paletteSwatchUrl: string | null = null;
    const ipAdapterEnabled = process.env.FLUX_ENABLE_IP_ADAPTER === '1';
    if (palette && ipAdapterEnabled) {
      try {
        const swatchBuf = await generatePaletteSwatch(palette);
        paletteSwatchUrl = await uploadImageBuffer(
          swatchBuf,
          `palette-${palette.id}.png`,
          'image/png',
        );
        console.log(`[render] IP-Adapter ON — palette swatch uploaded for ${palette.id}`);
      } catch (err) {
        console.warn('[render] palette swatch upload failed, falling back to text-only', err);
      }
    }
    const submission = await submitDepthRender({
      prompt: groundedPrompt,
      controlImageUrl,
      paletteSwatchUrl,
      width: dims?.width,
      height: dims?.height,
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
