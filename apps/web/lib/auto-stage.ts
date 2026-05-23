// #82 — auto-stage every detected item on every render.
//
// Background: the initial Flux render is text-conditioned only — Flux
// gets a descriptive phrase per hero product ("low-slung boucle sofa,
// walnut coffee table") and paints its interpretation. The actual SKU
// pixels only land via the staging composite pipeline (lib/staging.ts)
// which today is manual ("Stage this product" / "Stage several"
// buttons in the picking list UI).
//
// This module wires the same `stageMultipleProducts()` call into the
// post-render `after()` task so the real product images appear in the
// rendered scene by default — no user click required. The picking list
// is still surfaced so the user can override individual picks and
// re-stage; auto-stage just gives them a sensible default to start
// from.
//
// Failure mode: any error inside this module is logged and swallowed.
// The user still sees the base Flux render + picking list — auto-stage
// is progressive enhancement, never a blocker. The kill-switch is the
// env var AUTO_STAGE_ALL=false (default: enabled).

import type { SupabaseClient } from '@supabase/supabase-js';
import { stageMultipleProducts, type MultiStageItem } from '@/lib/staging';
import { appendRevision } from '@/lib/revisions';
import type { PickingListItem } from '@/lib/matching';

// Cap matches the manual /api/stage-multi MAX_ITEMS so prompt + composite
// cost stays bounded — 4 cutouts × ~3s = ~12s parallel, single composite
// + harmonise on top is ~10s. Total auto-stage overhead lands around
// 20-30s after the picking list flips to 'ready'.
const MAX_AUTO_STAGE_ITEMS = 4;

export interface AutoStageContext {
  admin: SupabaseClient;
  renderId: string;
  userId: string;
  /** Storage key inside the `rooms` bucket for the original room photo
   *  (e.g. `<user_id>/<filename>.webp`). Required — auto-stage skips
   *  when this is null. */
  roomPhotoKey: string | null;
  projectId: string | null;
  pickingListItems: PickingListItem[];
}

export type AutoStageOutcome = 'completed' | 'failed' | 'skipped';

export interface AutoStageResult {
  outcome: AutoStageOutcome;
  staged: number;
  skipped: number;
  /** Human-readable detail. On 'skipped' explains why; on 'failed'
   *  carries the underlying error message (truncated). On 'completed'
   *  may be undefined or carry a "+N skipped" detail. Surfaced into
   *  renders.auto_stage_error by the status route. */
  reason?: string;
}

/**
 * Auto-stage the top-matched SKU for every detected non-paint item.
 * Idempotency: relies on the caller (status route's `after()` block)
 * only running once per successful render — same gate as the picking
 * list build itself.
 *
 * Returns a structured result. The caller is expected to persist
 * `outcome` into renders.auto_stage_status and `reason` into
 * renders.auto_stage_error (#165 observability).
 */
export async function autoStageAfterPickingList(
  ctx: AutoStageContext,
): Promise<AutoStageResult> {
  if (process.env.AUTO_STAGE_ALL === 'false') {
    return { outcome: 'skipped', staged: 0, skipped: 0, reason: 'kill-switch (AUTO_STAGE_ALL=false)' };
  }
  if (!ctx.roomPhotoKey) {
    return { outcome: 'skipped', staged: 0, skipped: 0, reason: 'no room photo key' };
  }
  if (ctx.pickingListItems.length === 0) {
    return { outcome: 'skipped', staged: 0, skipped: 0, reason: 'empty picking list' };
  }

  // Filter down to items we can actually stage:
  //   - drop wall-paint items (no bbox-shaped product image, the paint
  //     match is for the picking list / cost rollup only)
  //   - require a top match with a productId AND an imageUrl
  //   - drop items where the bbox is degenerate (zero area)
  // Then cap at MAX_AUTO_STAGE_ITEMS. We keep the picking-list order
  // (Florence-2 ranks by detection confidence) so the top N detected
  // items are the ones that get composited.
  const items: MultiStageItem[] = [];
  let skippedPaint = 0;
  let skippedNoMatch = 0;
  let skippedNoImage = 0;
  let skippedBadBbox = 0;

  for (const pl of ctx.pickingListItems) {
    if (items.length >= MAX_AUTO_STAGE_ITEMS) break;
    // Wall paint heuristic — matcher.ts unshifts a wall-paint pseudo-item
    // when paletteHexes is provided; its category is "wall paint" and
    // its top match (if any) is a Dulux paint row with no compositable
    // image bbox.
    if (/paint/i.test(pl.category) || /paint/i.test(pl.itemLabel)) {
      skippedPaint++;
      continue;
    }
    const top = pl.matches?.[0];
    if (!top?.productId) {
      skippedNoMatch++;
      continue;
    }
    if (!top.imageUrl) {
      skippedNoImage++;
      continue;
    }
    const b = pl.bbox;
    if (!b || b.w <= 0 || b.h <= 0) {
      skippedBadBbox++;
      continue;
    }
    items.push({
      productId: top.productId,
      bbox: b,
      product: {
        name: top.name,
        category: top.category,
        retailer: top.retailer,
        imageUrl: top.imageUrl,
        colors: [],
        materials: [],
      },
    });
  }

  const totalSkipped = skippedPaint + skippedNoMatch + skippedNoImage + skippedBadBbox;
  if (items.length === 0) {
    const reason = `no stageable items (paint=${skippedPaint} noMatch=${skippedNoMatch} noImage=${skippedNoImage} badBbox=${skippedBadBbox})`;
    return { outcome: 'skipped', staged: 0, skipped: totalSkipped, reason };
  }

  console.log(
    `[auto-stage] staging ${items.length} items for render ${ctx.renderId} (paint=${skippedPaint} noMatch=${skippedNoMatch} noImage=${skippedNoImage} badBbox=${skippedBadBbox} skipped)`,
  );

  // Wrap the heavy work (cutout × N → composite → harmonise → upload →
  // staged_images insert) and revision append in one try/catch so the
  // caller can persist a 'failed' outcome + error message regardless
  // of which sub-step blew up. Throwing the error preserves caller
  // semantics — the status route already swallows + persists.
  try {
    const result = await stageMultipleProducts({
      admin: ctx.admin,
      userId: ctx.userId,
      roomPhotoKey: ctx.roomPhotoKey,
      renderId: ctx.renderId,
      projectId: ctx.projectId,
      items,
    });

    if (!result.storageKey) {
      // staged_images row may still have landed inside
      // stageMultipleProducts — but we can't append a revision
      // without an image path. Bail with a structured 'failed'.
      console.warn(`[auto-stage] composite landed but no storageKey for ${ctx.renderId}`);
      return {
        outcome: 'failed',
        staged: items.length,
        skipped: totalSkipped,
        reason: 'composite returned no storageKey',
      };
    }

    // Flip the revision pointer so the render page shows the staged
    // composite as the canonical view. Label distinguishes auto-stage
    // from a user-initiated multi-stage in the revision strip so the
    // user can revert with one click if the auto-pick isn't what they
    // wanted.
    await appendRevision({
      admin: ctx.admin,
      renderId: ctx.renderId,
      userId: ctx.userId,
      kind: 'multi_staged',
      imageBucket: 'renders',
      imagePath: result.storageKey,
      sourceStagedImageId: result.stagedImageId,
      label: `+ ${items.length} products (auto)`,
    });

    return {
      outcome: 'completed',
      staged: items.length,
      skipped: totalSkipped,
      reason: totalSkipped > 0 ? `+ ${totalSkipped} items skipped during filter` : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // #170 — bumped from 400 to 2000 chars so per-item failure
    // details from compositeMultipleProducts (which aggregates up
    // to 4 items × ~250 chars of magic-bytes / sharp metadata)
    // survive the trim. Page payload impact negligible.
    const trimmed = msg.length > 2000 ? msg.slice(0, 2000) + '…' : msg;
    return {
      outcome: 'failed',
      staged: 0,
      skipped: totalSkipped,
      reason: `${trimmed}`,
    };
  }
}
