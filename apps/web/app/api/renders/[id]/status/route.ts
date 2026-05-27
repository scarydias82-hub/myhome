// GET /api/renders/[id]/status
//
// Polled by the render page. Two-stage completion model (2026-05-22):
// the render image and the picking list complete independently so the
// user sees the rendered room ~30s after submit instead of waiting
// 60-90s for everything to land at once.
//
// Each call:
//   - Reads the render row (status + picking_list_status + ...).
//   - If both stages terminal, returns as-is.
//   - If 'running' and fal still busy, returns the running state.
//   - If 'running' and fal just completed:
//       FOREGROUND (~5s):
//         a. Download the Flux result, upload to the renders bucket
//         b. UPDATE: status='succeeded', output_url, picking_list_status='building'
//         c. Schedule picking-list build via after()
//         d. Return immediately so the polling client refreshes the
//            page and the user sees the rendered image
//       BACKGROUND (after(), ~25-30s):
//         e. Run Florence-2 + matcher + wall-paint
//         f. UPDATE: picking_list, picking_list_status='ready' (or 'failed')
//   - If output_url set and picking_list_status='building':
//       Return current state, poll continues to catch the 'ready' flip.
//       TTL: if building > 120s, mark 'failed' so polls don't run forever.
//
// Pre-2026-05-22 this route did everything in one blocking call.
// `void fetch()` after return was tried and failed (Vercel killed the
// function before the outbound request initiated). `after()` is the
// supported pattern — runs in the response's worker after the response
// is flushed, bounded by maxDuration.

import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkActiveStatus, fetchActiveResult } from '@/lib/fal';
import {
  checkModeCPromptStatus,
  fetchComfyUIOutput,
  type ModeCPollResult,
} from '@/lib/comfyui';
import { buildPickingList } from '@/lib/matching';
import { findPaletteByHexes } from '@/lib/palettes';
import { autoStageAfterPickingList } from '@/lib/auto-stage';

export const runtime = 'nodejs';
// Foreground (image save) is ~5s; after() (matching) is ~25-30s. 120s
// gives the matching pipeline comfortable headroom even if a slow Claude
// retry kicks in. The response flushes after the foreground work, so
// the user perceives ~5s, not 120s.
export const maxDuration = 120;

// If picking_list_status has been 'building' for longer than this,
// assume the previous after() got killed and mark the build as failed
// so the user isn't stuck polling forever. They can retry via the
// rebuild button.
const PICKING_LIST_BUILD_TTL_MS = 120_000;

type PickingListStatus = 'not_started' | 'building' | 'ready' | 'failed';
type AutoStageStatus = 'started' | 'completed' | 'failed' | 'skipped' | null;

interface RenderRow {
  id: string;
  user_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output_url: string | null;
  picking_list: unknown;
  picking_list_status: PickingListStatus | null;
  cost_estimate_aud: number | null;
  fal_request_id: string | null;
  completed_at: string | null;
  style_profile_id: string | null;
  room_id: string | null;
  /** Needed by the auto-stage hook (#82) so the staged_images row +
   *  multi_staged revision land on the right project. */
  project_id: string | null;
  /** #171 — surfaced so the polling client can wait for auto-stage
   *  to be terminal too. Without this the client stops polling when
   *  picking_list_status flips to 'ready' and never picks up the
   *  staged composite that lands ~20-30s later. */
  auto_stage_status: AutoStageStatus;
  /** Render-time provider/flow choice. 'mode_c' routes the status
   *  poll through the ComfyUI tunnel branch below (PR #77 async
   *  refactor); other values fall through to the fal queue check. */
  render_mode: 'restyle' | 'design' | 'mode_c' | null;
  /** ComfyUI prompt_id returned by submitWorkflow at /api/render
   *  submit time. Only populated for Mode C renders. */
  comfyui_prompt_id: string | null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  // Resilient SELECT — the render_mode + comfyui_prompt_id columns
  // are recent migrations (20260526120000, 20260527000000). If either
  // hasn't been applied to this DB, the SELECT errors with "column
  // does not exist" and EVERY status poll fails. Retry with just the
  // base columns on schema-drift error so older databases keep
  // working (Mode C polling won't activate, but everything else
  // does — render_mode column missing means there are no Mode C
  // renders to poll anyway).
  const fullCols =
    'id, user_id, status, output_url, picking_list, picking_list_status, cost_estimate_aud, fal_request_id, completed_at, style_profile_id, room_id, project_id, auto_stage_status, render_mode, comfyui_prompt_id';
  const baseCols =
    'id, user_id, status, output_url, picking_list, picking_list_status, cost_estimate_aud, fal_request_id, completed_at, style_profile_id, room_id, project_id, auto_stage_status';
  let renderRes = await admin.from('renders').select(fullCols).eq('id', id).single();
  if (renderRes.error) {
    console.warn(
      `[status] SELECT with render_mode/comfyui_prompt_id failed (${renderRes.error.message}); retrying with base cols`,
    );
    renderRes = await admin.from('renders').select(baseCols).eq('id', id).single();
  }
  const render = renderRes.data as RenderRow | null;
  if (!render || render.user_id !== user.id) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  const pickingListStatus: PickingListStatus = render.picking_list_status ?? 'not_started';

  // TTL guard: if the picking-list build has been "building" longer
  // than PICKING_LIST_BUILD_TTL_MS without completing, the previous
  // after() got killed. Mark it failed so polls stop and the rebuild
  // button is the user's recovery path.
  if (
    pickingListStatus === 'building' &&
    render.completed_at &&
    Date.now() - new Date(render.completed_at).getTime() > PICKING_LIST_BUILD_TTL_MS
  ) {
    console.warn(`[status] picking-list build TTL exceeded for ${render.id}, marking failed`);
    await admin
      .from('renders')
      .update({ picking_list_status: 'failed' })
      .eq('id', render.id);
    return NextResponse.json({
      status: render.status,
      pickingListStatus: 'failed',
      pickingListError: 'Build exceeded time budget — try the rebuild button.',
    });
  }

  // Terminal states. The render lifecycle now has two terminal axes:
  // status (image render) and picking_list_status (matching). The
  // client should stop polling only when BOTH are terminal.
  const renderTerminal =
    render.status === 'succeeded' ||
    render.status === 'failed' ||
    render.status === 'cancelled';
  const pickingListTerminal =
    pickingListStatus === 'ready' ||
    pickingListStatus === 'failed' ||
    // not_started is terminal if the render itself failed/cancelled —
    // no point building a list for a render that doesn't exist.
    (pickingListStatus === 'not_started' && render.status !== 'succeeded');
  if (renderTerminal && pickingListTerminal) {
    return NextResponse.json({
      status: render.status,
      pickingListStatus,
      autoStageStatus: render.auto_stage_status,
    });
  }

  // Image already saved but matching still in progress. Just report
  // current state — the after() worker on a prior poll is doing the
  // build, no new work to kick off here.
  if (render.output_url && pickingListStatus === 'building') {
    return NextResponse.json({
      status: render.status,
      pickingListStatus,
      autoStageStatus: render.auto_stage_status,
    });
  }

  // Mode C — ComfyUI tunnel polling (PR #77 async refactor). The
  // submit handler stores the prompt_id; here we hit /history/{id}
  // on each /status call. When ComfyUI marks the prompt complete we
  // fetch the output buffer + upload to Supabase + flip the row to
  // succeeded. Status route stays fast (~1-2s per poll) — the
  // client polls every few seconds, so a Mode C render that takes
  // 5 minutes results in ~150 quick status calls rather than one
  // 5-minute-long /api/render call.
  if (render.render_mode === 'mode_c') {
    if (!process.env.COMFYUI_URL) {
      // Submit succeeded earlier with the URL set; URL has since
      // been unset. Mark failed so the row doesn't spin.
      await admin
        .from('renders')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          picking_list_status: 'failed',
        })
        .eq('id', render.id);
      return NextResponse.json({
        status: 'failed',
        pickingListStatus: 'failed',
        error: 'COMFYUI_URL unset on server',
      });
    }
    if (!render.comfyui_prompt_id) {
      // Submit failed to persist the prompt_id earlier (likely the
      // 20260527000000 migration not applied). Mark failed loudly
      // rather than poll forever.
      await admin
        .from('renders')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          picking_list_status: 'failed',
        })
        .eq('id', render.id);
      return NextResponse.json({
        status: 'failed',
        pickingListStatus: 'failed',
        error: 'No comfyui_prompt_id on render row (migration may not be applied).',
      });
    }

    const probe: ModeCPollResult = await checkModeCPromptStatus(
      render.comfyui_prompt_id,
    ).catch(
      (err): ModeCPollResult => ({
        status: 'error',
        messages: [],
        summary: err instanceof Error ? err.message : String(err),
      }),
    );

    if (probe.status === 'queued' || probe.status === 'running') {
      return NextResponse.json({
        status: 'running',
        pickingListStatus,
        autoStageStatus: render.auto_stage_status,
      });
    }

    if (probe.status === 'error') {
      console.error(
        `[status] Mode C prompt ${render.comfyui_prompt_id} errored: ${probe.summary}`,
      );
      await admin
        .from('renders')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          picking_list_status: 'failed',
        })
        .eq('id', render.id);
      // User-facing error stays generic + recoverable. probe.summary
      // (the ComfyUI traceback) is logged above for owner debugging
      // but not returned to the client.
      return NextResponse.json({
        status: 'failed',
        pickingListStatus: 'failed',
        error:
          'Render service hit an issue. Try again — most failures clear within a few minutes.',
      });
    }

    // probe.status === 'success' — fetch the output bytes from
    // ComfyUI's /view endpoint, upload to Supabase storage in the
    // same shape Mode A produces (so /renders/[id]/page doesn't
    // need to branch on render_mode for image lookup), then flip
    // the row to succeeded.
    const successProbe = probe as Extract<ModeCPollResult, { status: 'success' }>;
    try {
      const outputBuf = await fetchComfyUIOutput(successProbe.image);
      const outKey = `${render.user_id}/${render.id}.png`;
      const upload = await admin.storage
        .from('renders')
        .upload(outKey, new Uint8Array(outputBuf), {
          contentType: 'image/png',
          cacheControl: '31536000',
          upsert: true,
        });
      if (upload.error) throw new Error(`storage upload: ${upload.error.message}`);

      // picking_list_status: 'ready' when the user pre-picked
      // products at submit time, else 'building' (status-route's
      // existing after() picks it up on the next poll).
      const hasInlinePicks =
        Array.isArray(render.picking_list) && render.picking_list.length > 0;
      await admin
        .from('renders')
        .update({
          status: 'succeeded',
          output_url: outKey,
          completed_at: new Date().toISOString(),
          picking_list_status: hasInlinePicks ? 'ready' : 'building',
        })
        .eq('id', render.id);
      console.log(
        `[status] Mode C ${render.id} succeeded — output saved to ${outKey}`,
      );
      return NextResponse.json({
        status: 'succeeded',
        pickingListStatus: hasInlinePicks ? 'ready' : 'building',
        autoStageStatus: render.auto_stage_status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[status] Mode C fetch/upload failed for ${render.id}:`, message);
      await admin
        .from('renders')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          picking_list_status: 'failed',
        })
        .eq('id', render.id);
      return NextResponse.json({
        status: 'failed',
        pickingListStatus: 'failed',
        error:
          'Render service hit an issue saving your output. Try again — most failures clear within a few minutes.',
      });
    }
  }

  // Running but no fal job — shouldn't happen; mark failed so we don't
  // poll forever.
  if (!render.fal_request_id) {
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json({
      status: 'failed',
      pickingListStatus: 'failed',
      error: 'No fal request id',
    });
  }

  // Provider-aware: dispatches to flux-general or kontext-multi based
  // on FLUX_PROVIDER env var. Default kontext-multi post-round-14.
  const fal = await checkActiveStatus(render.fal_request_id);

  if (fal.status === 'in_queue' || fal.status === 'in_progress') {
    return NextResponse.json({
      status: 'running',
      falStatus: fal.status,
      pickingListStatus,
      autoStageStatus: render.auto_stage_status,
    });
  }

  if (fal.status === 'failed') {
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json({ status: 'failed', pickingListStatus: 'failed' });
  }

  // fal.status === 'completed' — foreground: save image. Background
  // (after()): build picking list. Idempotency: if output_url is
  // already set we've already done the foreground; just report state.
  if (render.output_url) {
    return NextResponse.json({
      status: 'succeeded',
      pickingListStatus,
      autoStageStatus: render.auto_stage_status,
    });
  }

  try {
    const result = await fetchActiveResult(render.fal_request_id);
    const outKey = `${user.id}/${render.id}.webp`;

    // Step 1 (foreground, ~5s): download fal result, upload to storage.
    const bytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
    const upload = await admin.storage.from('renders').upload(outKey, bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    // Step 2 (foreground): mark image-stage succeeded + flip
    // picking_list_status to 'building' unless the user already
    // committed picks via the #179 curation step (in which case
    // /api/render's featuredProductIds branch set picking_list +
    // picking_list_status='ready' before submitting to fal). Don't
    // overwrite 'ready' back to 'building' — the after() picking
    // list build would then re-fire and either overwrite the user's
    // picks or get stuck because Vercel's CLIP load is broken.
    const userPicked = pickingListStatus === 'ready';
    await admin
      .from('renders')
      .update({
        status: 'succeeded',
        output_url: outKey,
        completed_at: new Date().toISOString(),
        picking_list_status: userPicked ? 'ready' : 'building',
      })
      .eq('id', render.id);

    // Pre-fetch palette + room context. We do this in the foreground
    // because the rows are small and we'd rather fail fast (palette
    // missing → wall-paint match skipped) than crash the background
    // task. The after() worker then runs purely against in-memory
    // values + fal CDN.
    let paletteHexes: string[] | undefined;
    let paletteId: string | undefined;
    if (render.style_profile_id) {
      const profileRes = await admin
        .from('style_profiles')
        .select('palette')
        .eq('id', render.style_profile_id)
        .single();
      const profile = profileRes.data as { palette: string[] | null } | null;
      paletteHexes = profile?.palette ?? undefined;
      const palette = findPaletteByHexes(paletteHexes);
      paletteId = palette?.id;
    }

    let roomType: string | undefined;
    // photo_url is the storage key inside the rooms bucket — needed by
    // the auto-stage hook (#82) to download the original room photo
    // for compositing. We fetch it here in the foreground so the
    // after() worker doesn't need a second round-trip.
    let roomPhotoKey: string | null = null;
    if (render.room_id) {
      const roomRes = await admin
        .from('rooms')
        .select('analysis, room_type, photo_url')
        .eq('id', render.room_id)
        .single();
      const room = roomRes.data as {
        analysis: { room_type?: string | null } | null;
        room_type: string | null;
        photo_url: string | null;
      } | null;
      const rawRoomType = room?.analysis?.room_type ?? room?.room_type ?? undefined;
      if (rawRoomType) roomType = rawRoomType.toLowerCase().replace(/\s+/g, '_');
      roomPhotoKey = room?.photo_url ?? null;
    }
    if (paletteId || roomType) {
      console.log(`[status] picking-list filter context: palette=${paletteId} room=${roomType}`);
    }

    // Step 3 (BACKGROUND via after()): run Florence-2 + matcher +
    // wall-paint. Runs after the response is flushed so the client
    // sees the image-ready state immediately. Bounded by maxDuration
    // (120s); recovery is the TTL guard at the top of the handler.
    const renderImageUrl = result.imageUrl;
    const renderId = render.id;
    const userId = user.id;
    const projectId = render.project_id;
    after(async () => {
      try {
        // #179 — skip Florence-2 + matcher when picking_list is
        // already set (the user-picked flow on /api/render's
        // featuredProductIds branch sets it inline). The list IS
        // the user's picks; no detection guesswork needed.
        if (pickingListStatus === 'ready') {
          console.log(
            `[status:after] picking_list already 'ready' (user picks) — skipping Florence-2`,
          );
          return;
        }
        console.log(`[status:after] building picking list for ${renderId}`);
        const matchRes = await buildPickingList({
          admin,
          renderImageUrl,
          paletteHexes,
          paletteId,
          roomType,
        });
        await admin
          .from('renders')
          .update({
            picking_list: matchRes.items,
            cost_estimate_aud: estimateTotal(matchRes.items),
            picking_list_status: 'ready',
          })
          .eq('id', renderId);
        console.log(
          `[status:after] picking list ready for ${renderId} — ${matchRes.items.length} items`,
        );

        // #82 — auto-stage the top-matched SKU into the rendered scene
        // for every detected non-paint item. Runs AFTER picking_list
        // flips to 'ready' so the user sees the picking list at the
        // earliest opportunity; the staged composite then arrives as
        // a new active revision (progressive enhancement). Failures
        // are logged + swallowed — base render + picking list still
        // succeed. Kill-switch: AUTO_STAGE_ALL=false env var.
        //
        // #165 — outcome is persisted to renders.auto_stage_status +
        // renders.auto_stage_error so the failure mode is visible from
        // the DB (Vercel function logs aren't always accessible).
        // 'started' is written eagerly so a function timeout / OOM
        // leaves a non-null status to read.
        //
        // Defensive: if the migration `20260522220000_renders_auto_stage_status.sql`
        // hasn't been applied yet, the column doesn't exist and the
        // UPDATE will error with PGRST204. We log + swallow so a
        // missing migration doesn't break the picking-list flow.
        const autoStageStartedRes = await admin
          .from('renders')
          .update({ auto_stage_status: 'started', auto_stage_error: null })
          .eq('id', renderId);
        const autoStageColumnsExist =
          !autoStageStartedRes.error ||
          !/auto_stage_status|column .* does not exist|PGRST204/i.test(
            autoStageStartedRes.error.message ?? '',
          );
        if (autoStageStartedRes.error) {
          console.warn(
            `[status:after] auto_stage_status pre-write failed for ${renderId} — migration likely not applied yet:`,
            autoStageStartedRes.error.message,
          );
        }
        try {
          const autoStageRes = await autoStageAfterPickingList({
            admin,
            renderId,
            userId,
            roomPhotoKey,
            projectId,
            pickingListItems: matchRes.items,
          });
          console.log(
            `[status:after] auto-stage for ${renderId}: outcome=${autoStageRes.outcome} staged=${autoStageRes.staged} skipped=${autoStageRes.skipped}${autoStageRes.reason ? ` (${autoStageRes.reason})` : ''}`,
          );
          if (autoStageColumnsExist) {
            const upd = await admin
              .from('renders')
              .update({
                auto_stage_status: autoStageRes.outcome,
                auto_stage_error: autoStageRes.reason ?? null,
              })
              .eq('id', renderId);
            if (upd.error) {
              console.warn(`[status:after] auto_stage_status final write failed for ${renderId}:`, upd.error.message);
            }
          }
        } catch (autoErr) {
          const msg = autoErr instanceof Error ? autoErr.message : String(autoErr);
          console.warn(
            `[status:after] auto-stage failed for ${renderId} — base render + picking list still succeeded`,
            msg,
          );
          if (autoStageColumnsExist) {
            await admin
              .from('renders')
              .update({
                auto_stage_status: 'failed',
                auto_stage_error: msg.length > 2000 ? msg.slice(0, 2000) + '…' : msg,
              })
              .eq('id', renderId)
              .then((r) => {
                if (r.error) console.warn(`[status:after] auto_stage_status fail-write failed for ${renderId}:`, r.error.message);
              });
          }
        }
      } catch (err) {
        console.error(`[status:after] picking list build failed for ${renderId}`, err);
        await admin
          .from('renders')
          .update({ picking_list_status: 'failed' })
          .eq('id', renderId);
      }
    });

    return NextResponse.json({
      status: 'succeeded',
      pickingListStatus: 'building',
      autoStageStatus: null,
    });
  } catch (err) {
    console.error('finalise render failed', err);
    await admin
      .from('renders')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        picking_list_status: 'failed',
      })
      .eq('id', render.id);
    return NextResponse.json(
      {
        status: 'failed',
        pickingListStatus: 'failed',
        error: err instanceof Error ? err.message : 'Finalise failed',
      },
      { status: 500 },
    );
  }
}

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
