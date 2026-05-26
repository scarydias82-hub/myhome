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
import {
  submitDepthRender,
  submitKontextRender,
  uploadImageBuffer,
  getActiveProvider,
} from '@/lib/fal';
import { getPalette } from '@/lib/palettes';
import { getDesignerAdvice } from '@/lib/designer';
import { autoFeatureForPalette, autoFeatureClaude } from '@/lib/featuring';
import { generatePaletteSwatch } from '@/lib/paletteSwatch';
import { buildKontextPrompt } from '@/lib/kontextPrompt';
import { trimBlackBorders, resizeForFlux } from '@/lib/imagePrep';
import type { RoomAnalysis } from '@/lib/vision';
import sharp from 'sharp';
import { submitOpenAIImageRender, buildOpenAIImagePrompt, buildModeBPrompt } from '@/lib/openai-image';
import { fetchKnowledgeImages } from '@/lib/knowledge';
import { buildPickingList, type PickingListItem } from '@/lib/matching';

// #173 — light helper for fetching catalogue product images and
// resizing them to a Kontext-friendly size before uploading to fal
// storage. JPEG output to keep the upload tiny. Browser headers
// because some retailer CDNs (Freedom, Coco) 403 on default fetch.
async function fetchAndResizeProductImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`product fetch ${res.status} ${url.slice(0, 80)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

function slugifyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// Multi-image reference budget for gpt-image-1's images.edit endpoint.
// Total per call = 1 (room) + 1 (palette) + N × K product images, where
// N = MAX_PRODUCTS_FOR_REFS and K = MAX_ANGLES_PER_PRODUCT. gpt-image-1
// hard cap is 16; current settings (4 × 2 = 8) leave 6 slots of headroom.
const MAX_PRODUCTS_FOR_REFS = 4;
const MAX_ANGLES_PER_PRODUCT = 2;

// Heuristic: BigCommerce CDN filenames for Coco encode the image type
// in the filename (Hero, Main Image, Front, Detail, Lifestyle_N, etc.).
// Lifestyle shots are styled-room shots with surrounding context that
// the renderer can accidentally splice into the output scene — exclude
// them from reference input so gpt-image-1 only sees the product on a
// neutral background. The regex tolerates both "_Lifestyle_1_" and
// "_LifestyleAngle1_" filename patterns Coco uses in practice.
const LIFESTYLE_FILENAME_RE = /_Lifestyle[A-Za-z]*[_-]?\d*[_-]/i;

// Pick the best reference image URLs for a single product. Prefers
// `imageUrls[]` (Coco hi-res rebuild #36 — multiple hero angles per
// product) and falls back to `imageUrl` (single image, older scrapers).
// Filters out lifestyle shots via LIFESTYLE_FILENAME_RE so the
// renderer only sees product-on-neutral-background references.
function pickRenderReferenceUrls(p: HeroProductDescriptor): string[] {
  const candidates =
    Array.isArray(p.imageUrls) && p.imageUrls.length > 0
      ? p.imageUrls
      : p.imageUrl
        ? [p.imageUrl]
        : [];
  const productOnly = candidates.filter((url) => !LIFESTYLE_FILENAME_RE.test(url));
  // If the lifestyle filter empties the list (e.g. a product page where
  // every shot is styled), fall back to the original candidates rather
  // than send the renderer no references at all.
  const final = productOnly.length > 0 ? productOnly : candidates;
  return final.slice(0, MAX_ANGLES_PER_PRODUCT);
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
  /** Flow mode (A4, 2026-05-26). 'a' = original photo-restyle flow
   *  (default — every existing caller). 'b' = the new floorplan-
   *  confirm + blank-canvas + Coco-only design flow. Persisted on
   *  the render row as render_mode = 'restyle' | 'design' so
   *  downstream surfaces can branch cleanly. */
  mode?: 'a' | 'b';
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
  if (!body.roomId) {
    return NextResponse.json({ error: 'Missing roomId.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Brief-driven defaults (#93): when the render is scoped to a project
  // and that project has a synthesised brief, use brief.recommendation
  // as the palette + style fallback if the body didn't pass them. This
  // closes the loop — the designer's recommendation actually drives the
  // render the user gets, without them having to re-pick the same
  // palette in /rooms/new.
  let briefStyleSlug: string | null = null;
  let briefPaletteId: string | null = null;
  if (body.projectId) {
    const briefProjectRes = await admin
      .from('projects')
      .select('user_id, brief')
      .eq('id', body.projectId)
      .single();
    const briefProject = briefProjectRes.data as
      | {
          user_id: string;
          brief: {
            response?: { recommendation?: { palette_id?: string; style_slug?: string } };
          } | null;
        }
      | null;
    if (briefProject && briefProject.user_id === user.id) {
      const rec = briefProject.brief?.response?.recommendation;
      if (rec) {
        briefStyleSlug = rec.style_slug ?? null;
        briefPaletteId = rec.palette_id ?? null;
      }
    }
  }

  const styleSlug = body.style ?? briefStyleSlug;
  if (!styleSlug) {
    return NextResponse.json(
      { error: 'Pick a style — or set a project brief and the designer will choose for you.' },
      { status: 400 },
    );
  }
  const style = getStyle(styleSlug);
  if (!style) {
    return NextResponse.json({ error: `Unknown style: ${styleSlug}` }, { status: 400 });
  }
  const paletteIdToUse = body.paletteId ?? briefPaletteId;
  const palette = paletteIdToUse ? getPalette(paletteIdToUse) ?? null : null;

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

  // Mode flag (A4). 'b' opts into the blank-canvas Coco design flow;
  // anything else (including undefined) stays on the original
  // photo-restyle path. Persisted on the render row as render_mode
  // so result-page + analytics surfaces can branch on a single
  // typed column rather than re-deriving from request context.
  const mode: 'a' | 'b' = body.mode === 'b' ? 'b' : 'a';
  const renderMode = mode === 'b' ? 'design' : 'restyle';

  const renderRes = await admin
    .from('renders')
    .insert({
      user_id: user.id,
      room_id: room.id,
      style_profile_id: profile.id,
      status: 'running',
      project_id: verifiedProjectId,
      render_mode: renderMode,
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
  // #176 — hoisted so the gpt-image-1 path below can use it (was
  // previously only declared inside the else-if(palette) auto-feature
  // block and therefore out of scope for the openai branch).
  const roomType = (room.analysis as RoomAnalysis | null)?.room_type ?? null;
  if (body.featuredProductIds && body.featuredProductIds.length > 0) {
    // #179 — designer-curated picking step. User picked specific
    // products before submitting the render. These become BOTH:
    //   - heroProducts (top 4 → renderer prompt + multi-image refs)
    //   - picking_list (all picks → exact items shown to the user
    //     post-render, with synthetic centred bboxes since we no
    //     longer detect; the user already knows what's in the scene)
    //
    // Also auto-saves each pick to user_wishlist (idempotent upsert)
    // so the feedback loop closes — next render's curation step
    // pins these to the front.
    const ids = body.featuredProductIds.slice(0, 12);
    interface PickedRow {
      id: string;
      name: string;
      category: string;
      retailer: string;
      price_aud: number | null;
      image_url: string | null;
      image_urls: string[] | null;
      product_url: string | null;
      affiliate_url: string | null;
      vision_profile: { silhouette?: string | null } | null;
      dimensions: {
        width_cm?: number | null;
        depth_cm?: number | null;
        height_cm?: number | null;
      } | null;
    }
    const { data } = await admin
      .from('products')
      .select('id, name, category, retailer, price_aud, image_url, image_urls, product_url, affiliate_url, vision_profile, dimensions')
      .in('id', ids);
    const rows = (data ?? []) as PickedRow[];
    if (rows.length > 0) {
      heroProducts = rows.map((p) => ({
        name: p.name,
        category: p.category,
        retailer: p.retailer,
        imageUrl: p.image_url ?? null,
        // Multi-image array (Coco hi-res rebuild #36). NULL for older
        // single-image scrapers — renderer falls back to imageUrl in
        // that case.
        imageUrls: p.image_urls ?? null,
        // Silhouette from vision_profile (post-#145 Haiku pre-pass).
        // 3-8 word physical description used by buildOpenAIImagePrompt
        // to anchor each per-product directive — much stronger signal
        // than "a lounge chair" for gpt-image-1 to honour the
        // reference image fidelity. Falls back to category descriptor
        // when null (older products / pre-vision-profile rows).
        silhouette: p.vision_profile?.silhouette ?? null,
        // Dimensions from the scraper — buildOpenAIImagePrompt derives
        // a size descriptor (compact / standard / oversized) from
        // these and includes both descriptor + raw cm in the
        // per-product directive. Null when the scraper couldn't parse
        // them from the source page.
        dimensions: p.dimensions ?? null,
      }));

      // Build the picking list from the picks. Synthetic bboxes
      // distributed across the lower half of the image where most
      // furniture sits — purely for hotspot positioning, no detection.
      const pickingListItems = rows.map((p, i) => ({
        itemLabel: p.category.toLowerCase(),
        category: p.category,
        bbox: {
          x: 0.15 + (i % 3) * 0.28,
          y: 0.45 + Math.floor(i / 3) * 0.18,
          w: 0.18,
          h: 0.14,
        },
        matches: [
          {
            productId: p.id,
            name: p.name,
            retailer: p.retailer,
            category: p.category,
            priceAud: p.price_aud,
            imageUrl: p.image_url ?? '',
            productUrl: p.product_url ?? '',
            affiliateUrl: p.affiliate_url,
            similarity: 1.0,
          },
        ],
      }));

      // Persist picking_list + flip status='ready' immediately. Any
      // downstream Florence-2 + match flow (status route's after())
      // will skip the rebuild when it sees picking_list_status is
      // already 'ready'.
      const plUpd = await admin
        .from('renders')
        .update({
          picking_list: pickingListItems,
          picking_list_status: 'ready',
        })
        .eq('id', render.id);
      if (plUpd.error) {
        console.warn('[render] picking_list pre-set failed:', plUpd.error.message);
      } else {
        console.log(
          `[render] picking_list pre-set from ${rows.length} user picks — Florence-2 will skip`,
        );
      }

      // Auto-write each pick to user_wishlist (feedback loop). The
      // unique constraint is (user_id, product_id); ignoreDuplicates
      // means existing rows are no-ops, no error.
      const wlRows = rows.map((p) => ({ user_id: user.id, product_id: p.id }));
      const wlUpd = await admin
        .from('user_wishlist')
        .upsert(wlRows, { onConflict: 'user_id,product_id', ignoreDuplicates: true });
      if (wlUpd.error) {
        console.warn('[render] wishlist upsert failed:', wlUpd.error.message);
      }

      // #180 — also persist hero_products on the render row for the
      // FeaturedPiecesStrip on /renders/[id]. The else-if(palette)
      // auto-curation branch already does this (line ~339); the
      // user-picked branch was missing it. Best-effort.
      const heroUpd = await admin
        .from('renders')
        .update({ hero_products: heroProducts })
        .eq('id', render.id);
      if (heroUpd.error) {
        console.warn(
          `[render] hero_products persist failed (user-picked path) — migration likely not applied: ${heroUpd.error.message}`,
        );
      }
    }
  } else if (palette) {
    // #129 — Claude-curated default. Reads the brief + room + palette
    // + style + a candidate set and picks 3-5 cohesive products that
    // respect the user's avoid list and material preferences. Each
    // render becomes meaningfully more aligned to the brief.
    //
    // Brief context comes from the project's stored brief (synthesised
    // in Step 3 of the wizard via /api/projects/[id]/analyse). When
    // the render isn't project-scoped, or the project has no brief
    // yet, briefResponse is null — Claude still picks from candidates
    // but with no avoid signal.
    const roomFacts = (room.analysis as RoomAnalysis | null) ?? null;

    // Fetch brief (best-effort — falls through to null on any error).
    // Tag priority chain mirrors /api/recommend (§6.11 Phase C, #155):
    //   project brief tags → canonical `users.preferences.tags` → []
    // Outside-project uploads previously fell through to [] here even
    // when the user had set canonical preferences — closed by #156 so
    // the auto-feature path always sees taste signal when one exists.
    let briefResponse: import('@/lib/brief/synthesiser').BriefSynthesis | null = null;
    let briefTags: string[] = [];
    if (verifiedProjectId) {
      const briefRes = await admin
        .from('projects')
        .select('brief')
        .eq('id', verifiedProjectId)
        .maybeSingle();
      const brief = (briefRes.data as
        | { brief: { tags?: string[]; response?: import('@/lib/brief/synthesiser').BriefSynthesis | null } | null }
        | null)?.brief;
      briefResponse = brief?.response ?? null;
      briefTags = Array.isArray(brief?.tags) ? brief!.tags! : [];
    }
    if (briefTags.length === 0) {
      // Canonical user prefs fallback. Outside-project uploads, and
      // projects whose brief.tags happens to be empty, both pick up the
      // dashboard chip picker's value. Snapshot semantics: this only
      // READS users.preferences — never writes back.
      const prefsRes = await admin
        .from('users')
        .select('preferences')
        .eq('id', user.id)
        .maybeSingle();
      const prefs = (prefsRes.data as { preferences: { tags?: string[] } | null } | null)?.preferences;
      if (prefs && Array.isArray(prefs.tags) && prefs.tags.length > 0) {
        briefTags = prefs.tags;
      }
    }

    // Try the Claude-curated path first. autoFeatureClaude returns []
    // on any failure (no candidates, Claude unreachable, parse error,
    // hallucinated ids) — caller then transparently falls back to the
    // metadata-only path so Anthropic outages don't block renders.
    heroProducts = await autoFeatureClaude({
      admin,
      paletteId: palette.id,
      paletteName: palette.name,
      styleSlug: style.slug,
      styleName: style.name,
      roomType,
      roomFacts,
      briefResponse,
      briefTags,
      limit: 4,
    });

    if (heroProducts.length === 0) {
      // Fallback: metadata-only filter. Still better than no biasing
      // at all; the prompt will name palette-matched products even
      // if Claude couldn't reason about cohesion.
      heroProducts = await autoFeatureForPalette({
        admin,
        paletteId: palette.id,
        roomType,
        // #156 — fallback path is now prefs-aware too, so the user's
        // avoid signals still bite when Claude curation has failed.
        briefTags,
        limit: 3,
      });
      if (heroProducts.length > 0) {
        console.log(
          `[render] FALLBACK metadata auto-feature ${heroProducts.length} for palette=${palette.id} room=${roomType}: ` +
            heroProducts.map((p) => `${p.retailer}/${p.category}/${p.name}`).join(' · '),
        );
      }
    }

    // #174 — persist hero_products on the render row so the page can
    // display the pre-selection immediately (no polling race) and the
    // user can see WHAT went into the render the moment it's queued,
    // separately from the post-render Florence-2 picking_list. Defensive:
    // best-effort write — if the column doesn't exist (migration not
    // applied) the update errors but the render still goes through.
    if (heroProducts.length > 0) {
      const heroUpd = await admin
        .from('renders')
        .update({ hero_products: heroProducts })
        .eq('id', render.id);
      if (heroUpd.error) {
        console.warn(
          `[render] hero_products persist failed — migration likely not applied yet: ${heroUpd.error.message}`,
        );
      } else {
        console.log(
          `[render] hero_products persisted: ${heroProducts
            .map((p) => `${p.retailer}/${p.category}/${(p.name || '').slice(0, 30)}`)
            .join(' · ')}`,
        );
      }
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
    // Pre-process the source photo before handing it to fal:
    //   1. trimBlackBorders   — strip phone-screenshot letterbox bars
    //      (see lib/imagePrep.ts). Canny ControlNet treats the black
    //      edge as a hard wall boundary if left in.
    //   2. resizeForFlux      — downsize to 1024 long-edge (~1MP) at
    //      multiples of 32. Both flux-general and kontext-multi
    //      resample internally to ~1MP anyway, so the upload-form's
    //      1600-edge buffer is ~60% wasted bytes on the fal-fetch.
    //      Sending 1:1 with the model's working res cuts fal-fetch
    //      overhead with zero quality impact (model never sees the
    //      extra pixels regardless).
    // Always re-upload to fal storage — gives the fal endpoint a
    // small, fast-fetch URL instead of the larger Supabase-signed one.
    let dims: { width: number; height: number } | undefined;
    let controlImageUrl = signed.data.signedUrl;
    // #176 — keep the resized room + palette swatch buffers in scope
    // outside the fal upload blocks so the gpt-image-1 path below can
    // reuse them without re-fetching from Supabase.
    let resizedRoomBuf: Buffer | null = null;
    let paletteSwatchBuf: Buffer | null = null;
    try {
      const dl = await admin.storage.from('rooms').download(room.photo_url);
      if (dl.data) {
        const rawBuf = Buffer.from(await dl.data.arrayBuffer());
        const trim = await trimBlackBorders(rawBuf);
        if (trim.trimmed && trim.before && trim.after) {
          console.log(
            `[render] trimmed letterbox: ${trim.before.width}×${trim.before.height} → ${trim.after.width}×${trim.after.height}`,
          );
        }
        const resized = await resizeForFlux(trim.buf);
        dims = { width: resized.width, height: resized.height };
        resizedRoomBuf = resized.buf;
        console.log(
          `[render] resized for fal: ${resized.width}×${resized.height} (${(resized.buf.length / 1024).toFixed(0)} KB)`,
        );
        try {
          controlImageUrl = await uploadImageBuffer(
            resized.buf,
            `room-${render.id}-flux.jpg`,
            'image/jpeg',
          );
        } catch (err) {
          console.warn('[render] resized re-upload failed, using Supabase URL', err);
        }
      }
    } catch (err) {
      console.warn('[render] could not read photo dimensions, using default', err);
    }
    // Generate the palette swatch unconditionally when a palette is
    // selected — both providers benefit:
    //   - kontext-multi (default): swatch is REQUIRED as image_urls[1]
    //   - flux-general:  swatch becomes the IP-Adapter reference IF
    //     FLUX_ENABLE_IP_ADAPTER=1 (legacy flag, off by default after
    //     IP-Adapter tensor-mismatch issues forced the Kontext pivot)
    //   - openai-image-1 (#176): swatch goes as image[1] to gpt-image-1
    //     to anchor the palette tones.
    let paletteSwatchUrl: string | null = null;
    if (palette) {
      try {
        const swatchBuf = await generatePaletteSwatch(palette);
        paletteSwatchBuf = swatchBuf;
        paletteSwatchUrl = await uploadImageBuffer(
          swatchBuf,
          `palette-${palette.id}.png`,
          'image/png',
        );
        console.log(`[render] palette swatch uploaded for ${palette.id}`);
      } catch (err) {
        console.warn('[render] palette swatch upload failed, will use text-only fallback', err);
      }
    }

    const provider = getActiveProvider();
    console.log(`[render] provider: ${provider}`);

    // #176 — gpt-image-1 path. Synchronous: openai.images.edit returns
    // the rendered bytes directly (~15-30s), no queue. We save to
    // Supabase storage inline and update the render row to 'succeeded'
    // ourselves, then kick off the picking-list build via after() so
    // the status route's existing polling flow catches the transition.
    // No fal_request_id involved.
    if (provider === 'openai-image-1' && palette && resizedRoomBuf) {
      // Eligible products = anything with at least one image URL (single
      // or multi). Multi-image scrapers (Coco hi-res #36) populate
      // imageUrls[]; older scrapers populate only imageUrl.
      const productCandidates = heroProducts.filter(
        (p) =>
          (typeof p.imageUrl === 'string' && p.imageUrl.length > 0) ||
          (Array.isArray(p.imageUrls) && p.imageUrls.length > 0),
      );
      const productsForRefs = productCandidates.slice(0, MAX_PRODUCTS_FOR_REFS);

      // Build the flat list of (product, url) reference pairs. For each
      // product, take up to MAX_ANGLES_PER_PRODUCT product-only images
      // (lifestyle / styled-room shots filtered out via URL heuristic
      // since they carry surrounding context the renderer can splice
      // into the output scene). 4 products × 2 angles = 8 product
      // references max, plus 1 room + 1 palette = 10 total, well under
      // gpt-image-1's 16-image cap.
      const refPairs: Array<{ product: HeroProductDescriptor; url: string }> = [];
      for (const p of productsForRefs) {
        for (const url of pickRenderReferenceUrls(p)) {
          refPairs.push({ product: p, url });
        }
      }

      // Fetch all reference images in parallel. allSettled keeps a
      // single broken URL from killing the whole render.
      const productBufResults = await Promise.allSettled(
        refPairs.map(({ url }) => fetchAndResizeProductImage(url)),
      );
      const productImageBufs: Buffer[] = [];
      for (const r of productBufResults) {
        if (r.status === 'fulfilled') productImageBufs.push(r.value);
        else console.warn('[render-openai] product fetch failed:', r.reason instanceof Error ? r.reason.message : r.reason);
      }
      // For prompt purposes the refs list is one entry PER PRODUCT (not
      // per angle) — the prompt only names each product once, even if
      // multiple angles are sent. This keeps buildOpenAIImagePrompt's
      // existing N-product contract intact.
      //
      // Silhouette = the vision_profile-derived physical description
      // (3-8 words). Dimensions = scraped cm. Both fed into the
      // per-product directive so gpt-image-1 has concrete visual
      // language + scale to anchor against, rather than relying on
      // its priors for what "a sofa" / "a lounge chair" looks like.
      const refs = productsForRefs.map((p) => ({
        name: p.name,
        category: p.category,
        retailer: p.retailer,
        silhouette: p.silhouette ?? null,
        dimensions: p.dimensions ?? null,
      }));

      // Mode B (A4): fetch Coco lifestyle references from design_knowledge
      // RAG (PR #47/49) and use them as the visual style anchor in
      // place of the user's room photo. Tag overlap = ['coco',
      // 'contemporary', <room_type>, <palette_id>] so the retrieval
      // is context-aware (a bedroom render pulls bedroom Coco refs).
      // Falls back to the room photo if no refs come back (e.g. on
      // an environment where seedDesignKnowledgeFromCoco.js hasn't
      // been run yet) — better to render with the user's room as
      // starter than to 500.
      const styleRefBufs: Buffer[] = [];
      if (mode === 'b') {
        const ragTags = ['coco', 'contemporary'];
        if (roomType) ragTags.push(roomType);
        if (palette.id) ragTags.push(palette.id);
        const imageRefs = await fetchKnowledgeImages({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          admin: admin as any,
          tags: ragTags,
          limit: 4,
        });
        const cocoBufResults = await Promise.allSettled(
          imageRefs.map((r) => fetchAndResizeProductImage(r.image_url)),
        );
        for (const r of cocoBufResults) {
          if (r.status === 'fulfilled') styleRefBufs.push(r.value);
          else
            console.warn(
              '[render-openai] coco lifestyle ref fetch failed:',
              r.reason instanceof Error ? r.reason.message : r.reason,
            );
        }
        console.log(
          `[render-openai] Mode B — fetched ${styleRefBufs.length}/${imageRefs.length} Coco lifestyle refs (tags=${ragTags.join(',')})`,
        );
      }

      // Build the prompt according to mode. Mode B branches into
      // buildModeBPrompt which knows about the styleRef image ordering
      // and writes a blank-canvas brief (no "preserve architecture"
      // clause). Mode A keeps the existing buildOpenAIImagePrompt
      // behaviour exactly.
      // R1 (2026-05-26) — derive rug presence from vision so the
      // prompt knows whether to REPLACE the existing rug or ADD a
      // new one. `rooms.analysis.existing_furniture` is a vision-
      // extracted list of items with /rug/i indicating the source
      // photo shows one. `null` analysis → 'unknown' (let the model
      // decide based on the photo). Mode B is always blank-canvas
      // so buildModeBPrompt hardcodes 'absent' internally.
      const existingFurniture =
        (room.analysis as RoomAnalysis | null)?.existing_furniture ?? [];
      const flooringText = (room.analysis as RoomAnalysis | null)?.flooring ?? '';
      const hasExistingRug =
        existingFurniture.some((f) => typeof f?.item === 'string' && /rug/i.test(f.item)) ||
        /\brug\b/i.test(flooringText);
      const rugRoomContext: 'present' | 'absent' | 'unknown' =
        room.analysis == null ? 'unknown' : hasExistingRug ? 'present' : 'absent';
      const openaiPrompt =
        mode === 'b' && styleRefBufs.length > 0
          ? buildModeBPrompt({
              paletteName: palette.name,
              paletteVibe: palette.vibe ?? null,
              roomType,
              width_m: (room.analysis as RoomAnalysis | null)?.dimensions_approximate_m?.width ?? null,
              depth_m: (room.analysis as RoomAnalysis | null)?.dimensions_approximate_m?.depth ?? null,
              cocoLifestyleCount: styleRefBufs.length,
              productRefs: refs,
            })
          : buildOpenAIImagePrompt({
              paletteName: palette.name,
              paletteVibe: palette.vibe ?? null,
              styleName: style.name,
              roomType,
              productRefs: refs,
              rugRoomContext,
            });
      // If Mode B was requested but the RAG returned zero refs, fall
      // back to using the room photo as starter — the user gets a
      // Mode-A-flavoured render rather than a hard error.
      const useStyleRefsAsStarter = mode === 'b' && styleRefBufs.length > 0;
      if (mode === 'b' && styleRefBufs.length === 0) {
        console.warn(
          '[render-openai] Mode B requested but no Coco lifestyle refs in design_knowledge — falling back to Mode A render. Run apps/scraper/scripts/seedDesignKnowledgeFromCoco.js to populate.',
        );
      }
      console.log(
        `[render-openai] submitting gpt-image-1 (mode=${mode}): ${productImageBufs.length} product refs · ${styleRefBufs.length} style refs · ${roomType ?? '?'} · ${palette.id}`,
      );
      try {
        const result = await submitOpenAIImageRender({
          prompt: openaiPrompt,
          roomBuf: useStyleRefsAsStarter ? null : resizedRoomBuf,
          styleRefBufs: useStyleRefsAsStarter ? styleRefBufs : undefined,
          paletteSwatchBuf,
          productImageBufs,
          size: '1024x1024',
          quality: 'medium',
        });
        // Save to Supabase storage in the same shape as fal renders
        // so the rest of the page logic doesn't need to branch.
        const outKey = `${user.id}/${render.id}.png`;
        const upload = await admin.storage.from('renders').upload(outKey, result.imageBuf, {
          contentType: 'image/png',
          cacheControl: '31536000',
          upsert: true,
        });
        if (upload.error) throw new Error(`storage upload: ${upload.error.message}`);
        // Mark render succeeded. picking_list_status depends on
        // whether the user already picked products via the #179
        // curation step: if so, the featuredProductIds branch above
        // already set picking_list + picking_list_status='ready', and
        // we must NOT overwrite that back to 'building' (would re-
        // trigger Florence-2 in the after() and leave the user
        // staring at an indefinite spinner because Vercel's CLIP
        // load is broken). For auto-curated renders, 'building' is
        // correct — picking list gets built in after().
        const userPicked =
          body.featuredProductIds != null && body.featuredProductIds.length > 0;
        await admin
          .from('renders')
          .update({
            status: 'succeeded',
            output_url: outKey,
            completed_at: new Date().toISOString(),
            picking_list_status: userPicked ? 'ready' : 'building',
          })
          .eq('id', render.id);
        console.log(`[render-openai] saved + marked succeeded for ${render.id} (${result.durationMs}ms)`);
        // Kick off the picking-list build in the same after() pattern
        // the status route uses for fal renders. The picking list
        // reads the saved image via a signed URL so we re-sign here.
        const renderId = render.id;
        const paletteHexes = palette.colors.map((c) => c.hex);
        const paletteId = palette.id;
        const rt = roomType;
        after(async () => {
          try {
            // #179 — skip Florence-2 build when picking_list is
            // already set (the user-picked flow set it inline).
            const plCheck = await admin
              .from('renders')
              .select('picking_list_status')
              .eq('id', renderId)
              .maybeSingle();
            const currentStatus = (plCheck.data as { picking_list_status: string | null } | null)
              ?.picking_list_status;
            if (currentStatus === 'ready') {
              console.log(
                `[render-openai:after] picking_list already 'ready' (user picks) — skipping Florence-2`,
              );
              return;
            }
            const renderSigned = await admin.storage
              .from('renders')
              .createSignedUrl(outKey, 600);
            const renderImageUrl = renderSigned.data?.signedUrl;
            if (!renderImageUrl) {
              throw new Error('could not sign rendered image for picking list build');
            }
            const matchRes = await buildPickingList({
              admin,
              renderImageUrl,
              paletteHexes,
              paletteId,
              roomType: rt ?? undefined,
            });
            const items: PickingListItem[] = matchRes.items;
            await admin
              .from('renders')
              .update({
                picking_list: items,
                picking_list_status: 'ready',
              })
              .eq('id', renderId);
            console.log(`[render-openai:after] picking list ready for ${renderId} — ${items.length} items`);
          } catch (err) {
            console.error(`[render-openai:after] picking list build failed for ${renderId}`, err);
            await admin
              .from('renders')
              .update({ picking_list_status: 'failed' })
              .eq('id', renderId);
          }
        });
        return NextResponse.json({ id: render.id });
      } catch (err) {
        console.error('[render-openai] gpt-image-1 submit failed', err);
        await admin
          .from('renders')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            picking_list_status: 'failed',
          })
          .eq('id', render.id);
        const detail = err instanceof Error ? err.message : 'gpt-image-1 render failed';
        return NextResponse.json({ error: detail }, { status: 500 });
      }
    }

    let submission: { requestId: string };
    if (provider === 'kontext-multi' && palette && paletteSwatchUrl) {
      // Kontext path — [roomPhoto, paletteSwatch] + a prompt that
      // names each image's role and pipes per-fixture preserve
      // directives from vision.
      //
      // #175 — REVERTED the #173 product-image multi-input. Adding
      // product reference images to image_urls caused Kontext to
      // compose them as visible layout elements in the output rather
      // than treat them as visual references. Result: a collage with
      // the palette swatch panel and product images stitched into
      // the render. Reverted to the previous [room, palette]-only
      // signature; product references via Kontext multi need a
      // different endpoint OR a different model (gpt-image-1) which
      // we'll evaluate next. HeroProductDescriptor.imageUrl stays in
      // the type so we can re-light the path quickly if/when we find
      // the right approach.
      const kontextPrompt = buildKontextPrompt({
        basePrompt: groundedPrompt,
        paletteName: palette.name,
        roomFacts: room.analysis as RoomAnalysis | null,
      });
      submission = await submitKontextRender({
        prompt: kontextPrompt,
        controlImageUrl,
        paletteSwatchUrl,
      });
    } else {
      // flux-general path. Used when:
      //   - FLUX_PROVIDER=flux-general explicitly
      //   - no palette selected (Kontext requires one)
      //   - palette swatch upload failed
      // IP-Adapter (paletteSwatchUrl on this path) is opt-in via
      // FLUX_ENABLE_IP_ADAPTER=1 — disabled by default because the
      // InstantX + XLabs configs both 422 at fal's runtime.
      const useIpAdapter = process.env.FLUX_ENABLE_IP_ADAPTER === '1';
      submission = await submitDepthRender({
        prompt: groundedPrompt,
        controlImageUrl,
        paletteSwatchUrl: useIpAdapter ? paletteSwatchUrl : null,
        width: dims?.width,
        height: dims?.height,
      });
    }
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
