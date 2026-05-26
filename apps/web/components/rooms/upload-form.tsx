'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { Pill } from '@/components/saltbush/pill';
import { type StyleSlug } from '@/lib/styles';
import {
  isTrendForward,
  isTimeless,
  listPalettes,
  listPalettesForMode,
  paletteDirection,
  paletteSwatch,
  type Palette,
} from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';
import { cn } from '@/lib/utils';
import { FloorplanConfirmation } from '@/components/rooms/floorplan-confirmation';
import { prepareImageForUpload } from '@/lib/client/prepare-image-upload';
import { PreferencesModal } from '@/components/dashboard/preferences-modal';
import { BRIEF_TAG_GROUPS } from '@/lib/brief/taxonomy';

// P0-2 confidence gate. When Claude returns ALL the load-bearing
// facts we skip the manual review step entirely — the user can still
// hit "Edit" on the confirmed summary if they want to override. We
// reserve manual confirm for analyses where the room is ambiguous
// (room_type unknown/other, no flooring read, no light cues) since
// those are the cases where the downstream render most depends on
// the user catching a misread.
function isHighConfidenceAnalysis(a: RoomAnalysis): boolean {
  if (!a.room_type || a.room_type === 'other') return false;
  if (!a.flooring) return false;
  if (!a.light?.direction && !a.light?.quality) return false;
  if (!a.existing_colours || a.existing_colours.length === 0) return false;
  return true;
}

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

// Per-category pick count for the curation step. Most categories
// allow exactly 1 — the renderer multiplies single picks into the
// right number of instances for the room (see MULTI_INSTANCE_CATEGORIES
// in lib/openai-image.ts). A handful allow 2 where:
//   (a) the room typically has a matching pair (Bedside Table, Table
//       Lamp, Side Table)
//   (b) the user might want to mix two styles for visual interest
//       (Dining Chair, Stool — useful for breakfast-bar / dining-set
//       variety, even though the renderer can multiply a single pick)
// Both singular + plural forms map to the same count so any retailer's
// category labels work (Coco writes "Sofa", Freedom writes "Sofas").
const CATEGORY_PICK_COUNT: Record<string, number> = {
  Sofa: 1, Sofas: 1,
  Chair: 1, Chairs: 1,
  'Lounge Chair': 1, 'Lounge Chairs': 1,
  'Dining Chair': 2, 'Dining Chairs': 2,
  'Dining Table': 1, 'Dining Tables': 1,
  Bed: 1, Beds: 1,
  'Bedside Table': 2, 'Bedside Tables': 2,
  'Floor Lamp': 1, 'Floor Lamps': 1,
  'Table Lamp': 2, 'Table Lamps': 2,
  'Coffee Table': 1, 'Coffee Tables': 1,
  'Side Table': 2, 'Side Tables': 2,
  Rug: 1, Rugs: 1,
  Stool: 2, Stools: 2,
  Lighting: 1,
  Mirror: 1, Mirrors: 1,
};

function pickCountForCategory(label: string): number {
  return CATEGORY_PICK_COUNT[label] ?? 1;
}

// HEIC conversion + resize moved into lib/client/prepare-image-upload.ts
// so /rooms/new and the vision-board upload share the same pipeline.
// Any future tuning (quality, max dim, additional codec support)
// lands in one place.

interface AnalyseResponse {
  roomId: string;
  analysis: RoomAnalysis | null;
  error?: string;
}

interface RecommendResponse {
  recommendation: {
    paletteId: string;
    paletteName: string;
    styleSlug: string;
    direction: '2026' | 'timeless' | null;
    reasoning: string;
  } | null;
  /** Where the brief tags fed to the synthesiser came from
   *  (§6.11 Phase C, #155). Drives the "Using your X" inheritance
   *  banner above the carousels. */
  source?: 'override' | 'project' | 'user_prefs' | 'none';
  /** Echo of the tags actually used for the synthesis, so the
   *  override modal opens pre-populated with whatever the recommendation
   *  was grounded in. */
  appliedTags?: string[];
  error?: string;
}

// Kept for the auto-feature path internal contract; the user-facing
// Step 5 hero products picker was removed in #128. See #129 for the
// "I'm Feeling Lucky" auto-curation that will replace it server-side.
interface FeaturedProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
}

/** Flow mode determines which palette catalogue + entry-flow copy
 *  the picker exposes. Mode A (default) is the original photo-restyle
 *  flow with the full 56-palette catalogue. Mode B is the new
 *  floorplan-confirm + Coco-only design flow added 2026-05-26 —
 *  curated to the 5 ultra-contemporary palettes in MODE_B_PALETTE_IDS
 *  (see lib/palettes.ts). Everything else in this component stays
 *  identical between the modes for now; A2-A5 will diverge further
 *  (separate render path, floorplan UI, etc.). */
export type UploadFormMode = 'a' | 'b';

export function UploadForm({
  projectId,
  flowMode = 'a',
}: {
  projectId?: string | null;
  flowMode?: UploadFormMode;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RoomAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);

  // #179 — designer-curated picking step. Replaces the post-render
  // Florence-2 picking list flow: user picks 1-3 per core category
  // BEFORE the render so the products are guaranteed correct
  // (they chose them).
  const [curationOpen, setCurationOpen] = useState(false);
  const [curationLoading, setCurationLoading] = useState(false);
  // Tracks which palette the curationCategories were last fetched for.
  // Drives the auto-open effect: when the user picks a new palette,
  // paletteId !== loadedForPaletteId, so curation refetches + reopens
  // without needing a manual "Browse the designer's edit" click. Reset
  // by openCuration() once the fetch lands.
  const [loadedForPaletteId, setLoadedForPaletteId] = useState<string | null>(null);
  const [curationCategories, setCurationCategories] = useState<
    Array<{
      displayLabel: string;
      items: PickerItem[];
    }>
  >([]);
  const [picks, setPicks] = useState<Map<string, Set<string>>>(new Map());
  // Phase 2 of the photo flow (#143). Set true after vision returns
  // and we kick off /api/recommend; flipped back to false when the
  // recommendation arrives (or fails). Drives the overlay on the
  // carousels — distinct from `analysing` which drives the overlay
  // on the photo.
  const [recommending, setRecommending] = useState(false);
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false);
  // Mode B inserts a floorplan confirmation step between vision and
  // the palette picker. In Mode A there's no such step, so the gate
  // is permanently true. In Mode B, starts false; the
  // FloorplanConfirmation component flips it to true via its
  // onConfirm callback once the user accepts the room.
  const [floorplanConfirmed, setFloorplanConfirmed] = useState<boolean>(flowMode !== 'b');

  const [style, setStyle] = useState<StyleSlug>('japandi');
  // Default selected palette. For Mode B, picks the first palette in
  // MODE_B_PALETTE_IDS (editorial order). For Mode A, the first
  // palette in the full catalogue — unchanged from prior behaviour.
  const [paletteId, setPaletteId] = useState<string>(
    listPalettesForMode(flowMode)[0]?.id ?? '',
  );
  // Direction state was removed 2026-05-23 (#168). The three-carousel
  // picker collapsed into a single carousel + filter chips, so
  // direction is now a derived value (via paletteDirection() helper)
  // — no longer needs its own React state. Where we previously read
  // `direction` we now compute paletteDirection(palette) on the fly.
  // Reasoning string from Claude's room-grounded recommendation (#142).
  // Surfaced on the DesignerSummaryCard so the user sees WHY this
  // palette/direction was picked, not just THAT it was.
  const [recommendationReasoning, setRecommendationReasoning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // §6.11 Phase C (#155) — inheritance source + per-render override.
  // recommendationSource tells us where the tags that fed the synth
  // came from (project / user_prefs / override / none). When the user
  // clicks "Customise for this image", the override modal opens with
  // appliedTags pre-selected; saving sets overrideTags + re-fires
  // recommend. overrideTags lives in this component only — never
  // persisted to users.preferences or any project.
  const [recommendationSource, setRecommendationSource] = useState<
    'override' | 'project' | 'user_prefs' | 'none' | null
  >(null);
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  const [overrideTags, setOverrideTags] = useState<string[] | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Hero products are an optional Step 5 — user selects up to 3 specific
  // catalogue items to "feature" so the Flux prompt biases toward them.
  // Hero products picker dropped in #128. The server-side auto-feature
  // path in /api/render still selects palette-matched products to bias
  // the Flux prompt — it just no longer needs a user-curated list to
  // start from. Kept featuredIds typing as an empty array constant so
  // the existing render-submit payload doesn't change shape.
  const featuredIds: string[] = [];

  // Trend-card previews per palette — loaded once the analysis confirms,
  // filtered by the room_type Claude identified so the palette swatches
  // show the user what each palette looks like in a room LIKE theirs.
  const [trendPreviews, setTrendPreviews] = useState<Map<string, TrendPreview>>(new Map());

  // Brief-driven defaults (#93): when this render is scoped to a project
  // that has a synthesised brief, pre-fill the style + palette state
  // from brief.recommendation so the designer's recommendation drives
  // the picker. User can still override either; we just remove the
  // friction of re-picking what they already agreed to.
  const [briefPreFilled, setBriefPreFilled] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/brief`)
      .then((r) => r.json())
      .then((j: { response?: { recommendation?: { palette_id?: string; style_slug?: string } } | null }) => {
        if (cancelled) return;
        const rec = j.response?.recommendation;
        if (!rec) return;
        if (rec.style_slug) setStyle(rec.style_slug as StyleSlug);
        if (rec.palette_id) {
          setPaletteId(rec.palette_id);
          // #168 — direction is derived from the selected palette,
          // no separate state to set. The card label and banner
          // compute paletteDirection() at render time.
        }
        setBriefPreFilled(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // #128 — featured-products fetch dropped. The server-side
  // auto-feature path in /api/render runs the same query when the
  // body's featuredProductIds is empty, so the prompt biasing still
  // happens — just without a user-facing curation step that 90% of
  // visitors skipped.

  useEffect(() => {
    if (!analysisConfirmed) return;
    const roomType = analysis?.room_type ?? null;
    const url = roomType
      ? `/api/trend-previews?roomType=${encodeURIComponent(roomType)}`
      : '/api/trend-previews';
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((j: { previews?: TrendPreview[] }) => {
        if (cancelled) return;
        const map = new Map<string, TrendPreview>();
        for (const p of j.previews ?? []) map.set(p.paletteId, p);
        setTrendPreviews(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analysisConfirmed, analysis?.room_type]);

  // Warmup keepalive. Fires on mount (paletteId has a default value)
  // and again whenever the user lands on a different palette. Keeps
  // fal's queue + Anthropic warm even if the user hesitates past the
  // ~5-minute cache window between upload and submit. Fire-and-forget;
  // a failed warm-up never blocks render submit.
  useEffect(() => {
    fetch('/api/warm', { method: 'POST' }).catch(() => {});
  }, [paletteId]);

  // Auto-open the curation step once we have an analysed room AND a
  // selected palette, so the user sees products immediately instead of
  // clicking a "Browse the designer's edit" button. Refires when the
  // user goes back and picks a different palette — `loadedForPaletteId`
  // tracks which palette curationCategories were fetched for, so a
  // palette change triggers a refetch + reopen. Guarded against
  // concurrent fetches via curationLoading.
  useEffect(() => {
    if (!analysisConfirmed || !paletteId) return;
    // Mode B inserts a floorplan confirmation between vision and the
    // picker — don't auto-open the picker until the user has
    // accepted the floorplan. In Mode A, floorplanConfirmed is
    // permanently true so this is a no-op.
    if (!floorplanConfirmed) return;
    if (curationLoading) return;
    if (loadedForPaletteId === paletteId) return;
    void openCuration();
    // openCuration captures `roomId`, `paletteId`, `style` from the
    // surrounding scope and sets loadedForPaletteId on success — the
    // deps below are the trigger conditions, not the closed-over vars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisConfirmed, paletteId, loadedForPaletteId, floorplanConfirmed]);

  async function handleFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      setPreview(null);
      setRoomId(null);
      setAnalysis(null);
      setAnalysisConfirmed(false);
      setFloorplanConfirmed(flowMode !== 'b');
      return;
    }
    const mimeOk = ALLOWED_MIME.includes(next.type);
    const extOk = ALLOWED_EXT.test(next.name);
    if (!mimeOk && !extOk) {
      setError('Use a JPG, PNG, WebP, or HEIC photo.');
      return;
    }
    if (next.size > MAX_BYTES) {
      setError('Photo is over 15 MB. Try a smaller one.');
      return;
    }
    // HEIC conversion + resize via the shared helper. The
    // `converting` flag drives the visible "Converting HEIC → JPEG"
    // placeholder; we set it for the whole prepare step (which
    // includes the resize that runs on every large file, not just
    // HEIC) so the user always sees something during the work.
    const isHeic = /^image\/(heic|heif)$/i.test(next.type) || /\.(heic|heif)$/i.test(next.name);
    setConverting(true);
    let usable: File;
    try {
      usable = await prepareImageForUpload(next);
    } catch (err) {
      setError(
        isHeic
          ? 'Could not convert HEIC. Export as JPG from Photos.'
          : err instanceof Error
            ? err.message
            : 'Could not prepare image.',
      );
      setConverting(false);
      return;
    }
    setConverting(false);

    setFile(usable);
    setPreview(URL.createObjectURL(usable));
    // Note: we no longer auto-fire analysis here. The user clicks
    // "Get design advice" once the photo is in place — that makes
    // the Claude call explicit (and gives them a chance to swap
    // photos before paying the ~8s vision round-trip).
  }

  async function analysePhoto(photoFile: File) {
    setAnalysing(true);
    setAnalysis(null);
    setRoomId(null);
    setAnalysisConfirmed(false);
    setFloorplanConfirmed(flowMode !== 'b');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', photoFile);
      if (projectId) fd.append('projectId', projectId);
      // 2026-05-26 — owner reported "Load failed first time, works
      // second time" during Claude vision. PR #61 added retry-once;
      // owner reported (later same day) that the retry made the
      // worst-case wait LONGER — a true timeout case became 60s
      // (first attempt hits Vercel maxDuration) + 60s (retry hits
      // the same deadline) = 120s before any feedback, feeling
      // "indefinite".
      //
      // Now: bounded client-side timeout via AbortSignal. Each
      // attempt aborts at 70s (slightly past Vercel's 60s function
      // deadline so we don't pre-empt a function that's actually
      // about to return). One retry on abort/throw, then surface
      // the friendly error. Total worst-case wait: ~140s — but the
      // SECOND attempt only fires on hard-fail of the first, not on
      // 504 timeout, so most "Vercel killed the function" cases
      // skip the retry and surface the error immediately.
      const ATTEMPT_TIMEOUT_MS = 70_000;
      const submit = async (): Promise<Response> => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS);
        try {
          return await fetch('/api/analyse-room', {
            method: 'POST',
            body: fd,
            signal: ac.signal,
          });
        } finally {
          clearTimeout(t);
        }
      };
      let res: Response;
      try {
        res = await submit();
      } catch (firstErr) {
        console.warn('[upload-form] analyse-room first attempt failed, retrying:', firstErr);
        try {
          res = await submit();
        } catch (secondErr) {
          console.error('[upload-form] analyse-room second attempt also failed:', secondErr);
          const msg =
            secondErr instanceof DOMException && secondErr.name === 'AbortError'
              ? 'Claude vision is slow right now — the request timed out. Try again in a moment.'
              : secondErr instanceof Error
                ? secondErr.message
                : 'Network error. Try again.';
          setError(msg);
          return;
        }
      }
      const json = (await res.json().catch(() => ({}))) as AnalyseResponse;
      if (!res.ok) {
        setError(json.error ?? 'Could not analyse the room. Try another photo.');
        return;
      }
      setRoomId(json.roomId);
      setAnalysis(json.analysis);
      // #117 — auto-confirm the analysis in all cases. The fact-card
      // review UI is hidden; the analysis still cached on
      // rooms.analysis for downstream prompt grounding. When the
      // analysis fails entirely we surface the error message but
      // keep advancing the form so the user isn't blocked.
      if (!json.analysis) {
        setError(
          json.error ??
            'Vision analysis was unavailable, but you can still proceed. The restyle will be less precise.',
        );
      }
      // Vision is done. Show the carousels immediately (with their
      // default palette selection) — the recommendation arrives via
      // a separate call below, which has its own overlay on the
      // carousels themselves. #143.
      setAnalysisConfirmed(true);

      // Phase 2: kick off the recommendation. We fire-and-forget here
      // (no await) so the React render commits the analysing=false +
      // analysisConfirmed=true update first, which mounts the
      // carousels. Then the recommendation overlay fades in on top
      // of them while the synth runs.
      if (json.roomId && json.analysis) {
        void recommendForRoom(json.roomId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
    } finally {
      setAnalysing(false);
    }
  }

  async function recommendForRoom(rid: string, overrideTagsArg?: string[] | null) {
    setRecommending(true);
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: rid,
          projectId: projectId ?? null,
          // Only send the field when explicitly overriding — keeps the
          // server log noise down and avoids ambiguity between "no
          // override" and "override is an empty array".
          ...(overrideTagsArg && overrideTagsArg.length > 0
            ? { overrideTags: overrideTagsArg }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as RecommendResponse;
      // Always capture source + appliedTags so the inheritance banner
      // can render even when the synth itself failed (none-source).
      setRecommendationSource(json.source ?? 'none');
      setAppliedTags(json.appliedTags ?? []);
      if (!res.ok || !json.recommendation) {
        // Silent fallback — the carousels keep their default
        // selection. We don't surface an error because the user can
        // still proceed; this is best-effort enrichment.
        return;
      }
      const rec = json.recommendation;
      setPaletteId(rec.paletteId);
      if (rec.styleSlug) setStyle(rec.styleSlug as StyleSlug);
      // #168 — direction derived from paletteId; no separate state.
      setRecommendationReasoning(rec.reasoning);
      // Flip the "we have a designer's pick" flag so the summary
      // card shows the recommendation block + commentary even when
      // there's no project brief in the picture.
      setBriefPreFilled(true);
    } catch {
      // Same silent fallback as above.
    } finally {
      setRecommending(false);
    }
  }

  // Build a human label list for the inheritance banner. We turn the
  // tag slugs back into their display labels via the same BRIEF_TAG_GROUPS
  // taxonomy used by the modal so the user sees "Modern organic"
  // instead of "modern-organic".
  const TAG_LABEL_BY_SLUG: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const group of BRIEF_TAG_GROUPS) {
      for (const tag of group.tags) map[tag.slug] = tag.label;
    }
    return map;
  })();

  function handleOverrideSave(tags: string[]) {
    if (!roomId) return;
    setOverrideTags(tags);
    void recommendForRoom(roomId, tags);
  }

  function clearOverride() {
    if (!roomId) return;
    setOverrideTags(null);
    void recommendForRoom(roomId, null);
  }

  async function openCuration() {
    if (!roomId || !paletteId) {
      setError('Confirm the room and palette before browsing picks.');
      return;
    }
    setError(null);
    setCurationLoading(true);
    try {
      const res = await fetch('/api/render/curate-candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, paletteId, styleSlug: style }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        categories?: typeof curationCategories;
        error?: string;
      };
      if (!res.ok || !json.categories) {
        setError(json.error ?? 'Could not load curated picks. Try again.');
        return;
      }
      setCurationCategories(json.categories);
      setCurationOpen(true);
      setLoadedForPaletteId(paletteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setCurationLoading(false);
    }
  }

  // Per-category pick cap. Each category has a `pickCountForCategory`
  // value (1 default; 2 for pair categories like Bedside Table / Table
  // Lamp / Side Table or variety categories like Dining Chair / Stool).
  // Toggle logic:
  //   - Clicking a selected product deselects it
  //   - Clicking an unselected product with room available adds it
  //   - Clicking an unselected product at capacity is ignored — user
  //     deselects something first to swap
  // Renderer-side multiplication of single picks still applies for
  // categories in MULTI_INSTANCE_CATEGORIES (lib/openai-image.ts) — a
  // user picking 1 dining chair still gets 4-6 matching chairs in the
  // render; picking 2 lets them mix two styles in the same scene.
  function togglePick(categoryLabel: string, productId: string) {
    setPicks((prev) => {
      const next = new Map(prev);
      const curr = new Set(next.get(categoryLabel) ?? []);
      const maxN = pickCountForCategory(categoryLabel);
      if (curr.has(productId)) {
        curr.delete(productId);
      } else if (curr.size < maxN) {
        curr.add(productId);
      }
      if (curr.size > 0) next.set(categoryLabel, curr);
      else next.delete(categoryLabel);
      return next;
    });
  }

  function allCategoriesHavePick(): boolean {
    if (curationCategories.length === 0) return false;
    // Categories with zero candidates (e.g. no Dining Tables in the
    // picked palette) auto-satisfy — the user has nothing to pick
    // and the "No catalogue matches" hint already nudges them toward
    // changing palette. Without this, those rooms can never submit.
    return curationCategories.every(
      (cat) =>
        cat.items.length === 0 || (picks.get(cat.displayLabel)?.size ?? 0) >= 1,
    );
  }

  function getAllPickedIds(): string[] {
    return [...picks.values()].flatMap((s) => [...s]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId) {
      setError('Upload a photo first.');
      return;
    }
    if (!analysisConfirmed) {
      setError('Confirm the room analysis to continue.');
      return;
    }
    // #179 — when the curation step is open and picks are made,
    // forward those as featuredProductIds. The render path uses
    // them as both the heroProducts (for the renderer prompt /
    // refs) and the picking_list (so the user sees exactly what
    // they picked, no Florence-2 guesswork). If the curation step
    // hasn't been opened, fall through to the legacy featuredIds
    // (currently always []).
    const pickedIds = curationOpen ? getAllPickedIds() : featuredIds;
    if (curationOpen && !allCategoriesHavePick()) {
      setError('Pick at least one product per category before rendering.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId,
          style,
          paletteId,
          featuredProductIds: pickedIds,
          projectId: projectId ?? undefined,
          // A4: forward the flow mode to the render route so it can
          // branch into the blank-canvas Coco design pipeline when
          // the user came in via /design/new.
          mode: flowMode,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? 'Render failed. Try again.');
        setSubmitting(false);
        return;
      }
      router.push(`/renders/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <Step1Upload
        file={file}
        preview={preview}
        converting={converting}
        // #169 — overlay spans vision + recommend so the user sees one
        // continuous "designer is choosing" experience.
        selecting={analysing || recommending}
        onPick={handleFile}
        onBrowseFiles={() => fileInput.current?.click()}
      />
      {/* Single hidden file input. No `capture` attribute so iOS/Android
          surface the full native sheet (Take Photo + Photo Library +
          Choose File) rather than forcing the camera. Desktop opens the
          OS file chooser. The visible affordance in Step1Upload is the
          tappable surface — this input is just plumbing. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {/* "Get design advice" — explicit trigger for Claude vision.
          Shown once the photo is in place and no analysis has run
          yet. Making the Claude call user-initiated (vs auto-firing
          on file pick) means the user can swap the photo cheaply
          before paying the ~8s round-trip, and the affordance reads
          as "I'm asking the designer to take a look" rather than
          "the app is silently doing something." */}
      {file && !analysing && !analysisConfirmed ? (
        <section className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 text-center">
          <p className="font-display text-h4 text-ink">Ready when you are.</p>
          <p className="mt-1 text-[14px] text-ink-soft">
            Claude vision will read the room — light, flooring, architecture, existing
            colours — so the carousels below match your space.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant="cta"
              size="lg"
              onClick={() => file && void analysePhoto(file)}
              disabled={converting}
            >
              Get design advice
            </Button>
          </div>
        </section>
      ) : null}

      {/* AnalysingPlaceholder removed in favour of the overlay-on-photo
          treatment inside Step1Upload's preview. The standalone
          placeholder competed visually with the photo and made the
          page feel busy during the ~8s vision wait. */}
      {/* #117 — Step 2 review hidden from the user-facing flow. The
          analysis still runs server-side and caches on rooms.analysis
          (we need the room facts for buildPrompt's architecture-
          preservation directives and for the brief synthesiser's
          room-grounded reasoning). The previous fact-card UI added
          a step without adding decisions the user actually wanted to
          make — auto-confirm via #101 handled most cases silently
          already. This pulls the surface entirely. */}

      {/* DesignerSummaryCard removed per owner directive — the long
          room-read + reasoning block crowded the page and pushed the
          palette + product pickers below the fold. Step3Style below
          IS the brief "here's the recommended palette" surface (the
          pre-selected tile), and CurationStep auto-opens once the
          palette is locked. The DesignerSummaryCard component itself
          remains in the file (lines ~948+) as dead code; safe to
          remove in a follow-up sweep. */}

      {/* RecommendationSourceBanner (preferences chips + "Customise"
          CTA) removed per owner directive — was clutter between the
          designer summary and the palette/curation flow. The banner
          was originally from #155 Phase C to surface per-render override
          source; with the simplified flow (recommended palette →
          override via picker → products) the user doesn't need to see
          the source-of-recommendation chips inline. RecommendationSource
          state + override modal stays in code (unused for now;
          PreferencesModal is dead code that can be removed in a
          follow-up sweep once we're sure no other surface uses it). */}

      {/* Carousels mount as soon as analysis kicks off — not waiting
          for Phase 1 to complete. Single carousel overlay spans
          BOTH phases (analysing + recommending) so the user sees
          the destination they're heading toward while Claude works.
          The relative wrapper anchors the overlay to this region
          only — photo overlay above stays in place during Phase 1,
          photo becomes interactive again in Phase 2. */}
      {/* #169 — the photo overlay (DesignerSelectingOverlay) now
          handles all "designer is at work" messaging across the
          analyse + recommend phases. The carousel overlay was
          redundant and visually noisy; removed. Step3Style mounts
          underneath; while selecting=true the user can scroll the
          chips/palette filters but the focus stays on the photo
          overlay. */}
      {/* Mode B floorplan-confirmation step (A2). Sits between vision
          and the palette picker — gates Step3Style + the auto-open
          curation effect until the user confirms their room. Mode A
          skips this entirely (floorplanConfirmed defaults to true
          when flowMode='a'). */}
      {flowMode === 'b' && analysisConfirmed && !floorplanConfirmed ? (
        <FloorplanConfirmation
          width_m={analysis?.dimensions_approximate_m?.width ?? null}
          depth_m={analysis?.dimensions_approximate_m?.depth ?? null}
          roomType={analysis?.room_type ?? null}
          onConfirm={() => setFloorplanConfirmed(true)}
          onReupload={() => {
            // Reset back to the upload step. The user will pick a new
            // photo and re-run vision. Keeping projectId + style +
            // paletteId so they don't lose other choices.
            setFile(null);
            setPreview(null);
            setRoomId(null);
            setAnalysis(null);
            setAnalysisConfirmed(false);
            setFloorplanConfirmed(false);
            if (fileInput.current) fileInput.current.value = '';
          }}
        />
      ) : null}
      {analysing || (analysisConfirmed && floorplanConfirmed) ? (
        <Step3Style
          paletteId={paletteId}
          onPaletteChange={setPaletteId}
          trendPreviews={trendPreviews}
          flowMode={flowMode}
        />
      ) : null}

      {/* Step 5 hero products picker removed in #128. The auto-feature
          path in /api/render still selects palette-matched products to
          bias the Flux prompt — no user-facing step needed. #129 will
          replace this with Claude-driven product curation
          ("I'm Feeling Lucky") at first Fal pass. */}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-[14px] text-destructive">{error}</p>
          {/overload|temporar|try again|rate.?limit|briefly/i.test(error) && file ? (
            <button
              type="button"
              onClick={() => analysePhoto(file)}
              disabled={analysing}
              className="mt-2 rounded-pill border border-destructive/40 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-destructive transition hover:border-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              {analysing ? 'Retrying…' : '↻ Try again'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* #179 — designer-curated picking step. Sits between palette
          pick and render submit. User picks 1-3 per core category;
          those products become both the heroProducts for the
          renderer AND the picking list. Wishlist items are pinned
          to the front of each row. */}
      {curationOpen ? (
        <CurationStep
          categories={curationCategories}
          picks={picks}
          onTogglePick={togglePick}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {!curationOpen ? (
          <Button
            type="button"
            variant="cta"
            size="lg"
            onClick={openCuration}
            disabled={
              !analysisConfirmed || curationLoading || analysing || recommending
            }
          >
            {curationLoading ? 'Loading picks…' : "Browse the designer's edit →"}
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              variant="cta"
              size="lg"
              disabled={!allCategoriesHavePick() || submitting}
            >
              {submitting
                ? 'Restyling… (~30s)'
                : `Render with these ${getAllPickedIds().length} pick${getAllPickedIds().length === 1 ? '' : 's'}`}
            </Button>
            <button
              type="button"
              onClick={() => setCurationOpen(false)}
              className="font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:text-ink"
            >
              ← Back to palette
            </button>
          </>
        )}
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Designer-curated · rendered with gpt-image-1 + Flux Kontext
        </p>
      </div>

      {/* §6.11 Phase C (#155) override modal. Renders only when the
          user clicks "Customise for this image" — saves the chosen
          tags into local state + re-fires recommendForRoom with them.
          Saves NEVER touch users.preferences (canonical = dashboard
          only). */}
      <PreferencesModal
        open={overrideOpen}
        initialTags={overrideTags ?? appliedTags}
        persistMode="per-render"
        onClose={() => setOverrideOpen(false)}
        onSaveOverride={handleOverrideSave}
      />
    </form>
  );
}

// §6.11 Phase C (#155) inheritance banner. Surfaces where the
// recommendation's taste signal came from (project brief / canonical
// user preferences / per-render override) and offers the override
// action. Cold-start case (source='none') hides the banner entirely —
// we don't need to tell the user "we used no preferences"; the
// existing summary card already explains the recommendation.
function RecommendationSourceBanner({
  source,
  appliedTags,
  tagLabelBySlug,
  onCustomise,
  onClear,
}: {
  source: 'override' | 'project' | 'user_prefs';
  appliedTags: string[];
  tagLabelBySlug: Record<string, string>;
  onCustomise: () => void;
  /** Provided only when source is 'override' — clearing reverts back
   *  to the inherited prefs/project tags by re-firing /api/recommend
   *  with no override. */
  onClear?: () => void;
}) {
  const labelByKey: Record<typeof source, { eyebrow: string; explainer: string }> = {
    override: {
      eyebrow: 'Customised for this image',
      explainer:
        "Using a per-image override — your saved preferences on the dashboard aren't changed.",
    },
    user_prefs: {
      eyebrow: 'Using your preferences',
      explainer:
        "Pre-filled from your dashboard preferences. Override below for this image only — your saved preferences won't change.",
    },
    project: {
      eyebrow: 'Using your project brief',
      explainer:
        "Pre-filled from the brief you set on this project. Override below for this image only — the project's brief won't change.",
    },
  };
  const { eyebrow, explainer } = labelByKey[source];
  const chips = appliedTags.slice(0, 6);
  const overflow = appliedTags.length - chips.length;

  return (
    <section className="rounded-2xl border border-clay/30 bg-clay/[0.05] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">{eyebrow}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            {explainer}
          </p>
          {chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((slug) => (
                <span
                  key={slug}
                  className="rounded-pill border border-ink/15 bg-cream px-2.5 py-1 text-[12px] text-ink"
                >
                  {tagLabelBySlug[slug] ?? slug}
                </span>
              ))}
              {overflow > 0 ? (
                <span className="rounded-pill px-2.5 py-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  +{overflow} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-pill border border-ink/15 bg-cream px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCustomise}
            className="rounded-pill border border-clay/40 bg-clay/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-clay transition hover:bg-clay/25"
          >
            Customise →
          </button>
        </div>
      </div>
    </section>
  );
}

// Step 01 — single tap target. On mobile, tapping the empty tile opens
// the OS-native file sheet which surfaces "Take Photo", "Photo Library"
// and "Choose File" together; we don't ship a custom action sheet or a
// `getUserMedia` viewfinder because the native UI is faster, more
// accessible, and respects the user's default camera/photos apps. On
// desktop, the same tile also accepts drag-and-drop. After a file is
// chosen the tile becomes the preview — re-tapping (or dropping a new
// file on) the preview replaces it in place.
function Step1Upload({
  file,
  preview,
  converting,
  selecting,
  onPick,
  onBrowseFiles,
}: {
  file: File | null;
  preview: string | null;
  converting: boolean;
  /** True while the designer is at work — covers both /api/analyse-room
   *  (vision) AND /api/recommend (synthesis). Drives the photo overlay
   *  end-to-end so the user sees one continuous "designer is choosing"
   *  experience instead of two disjoint loading states. (#169) */
  selecting: boolean;
  onPick: (f: File | null) => void;
  onBrowseFiles: () => void;
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    onPick(e.dataTransfer.files?.[0] ?? null);
  }

  return (
    <section>
      <Eyebrow>Step 01 · Your room</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Upload a photo</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
        Daylight works best. Stand back so the whole room fits in the frame. JPG, PNG, WebP, or
        HEIC up to 15 MB.
      </p>

      <div className="mt-6">
        {preview ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="relative overflow-hidden rounded-2xl border border-ink/[0.06] bg-cream"
          >
            <Image
              src={preview}
              alt="Your room"
              width={1600}
              height={1200}
              className="block h-auto max-h-[600px] w-full object-contain bg-ink/5"
              unoptimized
            />
            {/* Designer-selecting overlay — sits ON the photo and stays
                visible across BOTH the vision pass and the recommend
                pass so the user sees one continuous "designer is at
                work" surface rather than two disjoint spinners. The
                scrolling palette ribbon makes the wait feel like the
                designer actively browsing options. (#169) */}
            {selecting ? (
              <DesignerSelectingOverlay />
            ) : (
              <button
                type="button"
                onClick={onBrowseFiles}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-pill border border-ink/15 bg-cream/95 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft shadow-sm backdrop-blur transition hover:border-clay/40 hover:text-clay"
              >
                Replace photo
              </button>
            )}
            {file && !selecting ? (
              <p className="absolute bottom-3 left-3 inline-flex items-center rounded-pill bg-ink/55 px-3 py-1 font-mono text-meta uppercase tracking-eyebrow text-cream backdrop-blur">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            ) : null}
          </div>
        ) : converting ? (
          <div className="grid min-h-[280px] place-items-center rounded-2xl border border-ink/[0.06] bg-cream p-8 text-center">
            <div>
              <div className="mx-auto h-3 w-40 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
              </div>
              <p className="mt-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Preparing photo
              </p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onBrowseFiles}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className={cn(
              'group flex w-full min-h-[280px] flex-col items-center justify-center gap-4',
              'rounded-2xl border-2 border-dashed border-ink/15 bg-paper-warm bg-grain p-8 text-center',
              'transition hover:border-clay/40 hover:bg-paper-warm/80',
              'focus-visible:border-clay/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/20',
            )}
            aria-label="Add a room photo"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full border border-ink/10 bg-cream text-ink-soft transition group-hover:border-clay/40 group-hover:text-clay">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3.25" />
              </svg>
            </span>
            <div>
              <p className="font-display text-h4 text-ink">Tap to add a room photo</p>
              <p className="mt-2 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Camera or photo library · or drag a file here
              </p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}

// DesignerSummaryCard — the "punchy designer summary" that lands
// after Claude vision completes. Two purposes:
//   1. Tell the user what Claude SAW (room read: type / light / floor)
//   2. Tell the user what the designer RECOMMENDS (when there's a brief)
//      + visualise what's pre-selected in the carousels below
//
// Surfaces always when analysisConfirmed; the recommendation block
// only renders when briefPreFilled (i.e. the user came in via a
// project workflow with an existing brief). When there's no brief
// the card stays useful — it's a room-read summary the user can
// glance at before scrolling into the carousels.
function DesignerSummaryCard({
  analysis,
  briefPreFilled,
  paletteId,
  reasoning,
}: {
  analysis: RoomAnalysis | null;
  briefPreFilled: boolean;
  paletteId: string;
  /** Optional 1-2 sentence "why" from Claude's room-grounded
   *  recommendation. Surfaced under the palette name so the user
   *  sees what drove the pick. */
  reasoning?: string | null;
}) {
  const palette = listPalettes().find((p) => p.id === paletteId) ?? null;
  // #168 — direction derived from the palette via the centralised
  // helper (single source of truth, #167). Was a prop in the
  // three-carousel era; now a derived value.
  const direction = paletteDirection(palette);

  // Compose the room-read line. We pick the highest-value facts and
  // skip null/unknown values so the line reads tight rather than
  // "Living room · unknown · unknown".
  const roomReadParts: string[] = [];
  if (analysis?.room_type && analysis.room_type !== 'other') {
    roomReadParts.push(analysis.room_type.replace(/_/g, ' '));
  }
  // Cardinal direction dropped from vision (#149) — Claude can't infer
  // compass orientation from a photo, and old cached analyses that
  // still carry it are ignored here to keep the surface honest.
  if (analysis?.light?.quality) {
    roomReadParts.push(`${analysis.light.quality} light`);
  }
  if (analysis?.flooring) roomReadParts.push(analysis.flooring);

  const directionLabel =
    direction === '2026'
      ? '2026 trend direction'
      : direction === 'timeless'
        ? 'Tried & tested direction'
        : null;

  return (
    <section className="rounded-2xl border border-clay/40 bg-gradient-to-br from-clay/[0.06] via-cream to-cream p-5 md:p-7">
      <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <Eyebrow>The designer&rsquo;s read</Eyebrow>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {briefPreFilled ? 'Brief + vision · grounded' : 'Vision only · grounded'}
        </p>
      </div>

      {/* Room read — capitalised first letter, dots between parts. */}
      <p className="mt-3 font-display text-h3 leading-tight text-ink md:text-[26px]">
        {roomReadParts.length > 0
          ? capitalise(roomReadParts.join(' · '))
          : 'Room read pending'}
      </p>

      {/* Commentary — Claude's punchy "why this direction" reasoning.
          ROOM → WHY → WHAT, one breath. The synthesiser prompt now
          targets ~30 words (#169), but cached project briefs from
          before that change can still be 2-3 sentences. The clamp
          + "Read more" pattern handles both gracefully: shows the
          first ~3 lines on mobile, expands on click, never crowds
          the real-estate above the carousels. */}
      <ReasoningBlock reasoning={reasoning ?? null} />

      {/* Recommendation block — once the synth has settled. Palette
          name + direction label sit alongside the swatch chip so
          the user maps "name" to "actual colours" instantly. */}
      {briefPreFilled && palette ? (
        <div className="mt-5 grid gap-4 border-t border-ink/[0.06] pt-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
              Recommended for this room
            </p>
            <p className="mt-1 font-display text-h4 text-ink md:text-[20px]">
              {palette.name}
            </p>
            <p className="mt-1 font-dmsans text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
              {palette.vibe}
              {directionLabel ? (
                <>
                  {' '}·{' '}
                  <span className="text-clay">{directionLabel}</span>
                </>
              ) : null}
            </p>
          </div>
          {/* Swatch chip — full palette in a pill. */}
          <div className="flex h-10 w-40 shrink-0 overflow-hidden rounded-full border border-ink/10 md:w-32">
            {paletteSwatch(palette).slice(0, 5).map((hex, i) => (
              <div key={`${hex}-${i}`} className="flex-1" style={{ backgroundColor: hex }} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Pre-selection summary chips — visible whenever we have any
          selection. Tells the user "this is set; scroll to change." */}
      {(briefPreFilled && palette) || direction ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink/[0.06] pt-4">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Pre-selected:
          </p>
          {palette ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-clay/40 bg-clay/10 px-3 py-1 font-mono text-meta uppercase tracking-eyebrow text-clay">
              ✓ {palette.name}
            </span>
          ) : null}
          {directionLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-clay/40 bg-clay/10 px-3 py-1 font-mono text-meta uppercase tracking-eyebrow text-clay">
              ✓ {directionLabel}
            </span>
          ) : null}
          <p className="basis-full font-dmsans text-[12px] text-ink-soft md:basis-auto md:ml-1 md:text-[13px]">
            Scroll to swap anything before rendering.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Truncate-with-expand commentary block used by DesignerSummaryCard
// (#169). Reasoning was previously rendered as an unbounded <p> that
// took 4-5 lines on mobile for typical Claude output. Synthesiser
// prompt now targets ~30 words, but cached older briefs from
// `projects.brief.response` can still be 2-3 sentences. Clamp to 3
// lines by default + "Read more" toggle handles both cleanly.
function ReasoningBlock({ reasoning }: { reasoning: string | null }) {
  const [expanded, setExpanded] = useState(false);
  // Heuristic: short enough that clamping wouldn't truncate → don't
  // even render the toggle. ~160 chars maps to roughly 3 lines on a
  // 360px viewport at our type scale.
  const isLong = (reasoning?.length ?? 0) > 160;
  return (
    <div className="mt-3">
      <p
        className={cn(
          'font-dmsans text-[14px] leading-relaxed text-ink md:text-[15px]',
          isLong && !expanded ? 'line-clamp-3' : '',
        )}
      >
        {reasoning ?? (
          <span className="text-ink-faint italic">
            Designer&rsquo;s reasoning is coming together…
          </span>
        )}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-clay transition hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? 'Less ↑' : 'Read more ↓'}
        </button>
      ) : null}
    </div>
  );
}

// DesignerSelectingOverlay (#169) — sits ON the photo while the
// designer is at work, across both the vision and recommend phases.
// Scrolling palette ribbon makes the wait feel like the designer is
// actively browsing options. Replaces the earlier static "Claude is
// reading the room" placeholder + the separate carousel-area
// overlay; one continuous loading surface.
//
// The palette swatch list is duplicated 2x so the marquee animation
// (defined in globals.css) translateX(-50%) loops seamlessly.
function DesignerSelectingOverlay() {
  const palettes = listPalettes();
  // Double the list for seamless marquee loop. Memoise via
  // useMemo so the doubled array isn't rebuilt every render.
  const doubled = [...palettes, ...palettes];
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden bg-ink/60 text-center backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      {/* Scrolling palette ribbon — runs behind the centred text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden opacity-90"
      >
        <div className="flex w-max gap-3 animate-marquee px-4">
          {doubled.map((p, i) => {
            const swatch = paletteSwatch(p);
            return (
              <div
                key={`${p.id}-${i}`}
                className="shrink-0 grid h-10 w-32 grid-cols-5 overflow-hidden rounded-md border border-cream/30 shadow-md md:h-12 md:w-40"
              >
                {swatch.slice(0, 5).map((hex, j) => (
                  <div key={`${hex}-${j}`} style={{ backgroundColor: hex }} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Centred copy — sits above the marquee with extra contrast. */}
      <div className="relative z-10 max-w-md px-6">
        <p className="font-dmmono text-[10px] uppercase tracking-eyebrow text-cream/80 md:text-[11px]">
          ✦ Designer at work
        </p>
        <p className="mt-2 font-display text-[22px] leading-tight text-cream md:text-[26px]">
          The designer is choosing a direction for you…
        </p>
        <p className="mt-2 font-dmsans text-[13px] leading-relaxed text-cream/85 md:text-[14px]">
          Reading the light, the flooring and the architecture — then choosing the palette that fits your taste signal.
        </p>
      </div>
    </div>
  );
}

// CarouselRecommendingOverlay — removed from active use 2026-05-23
// (#169) in favour of the DesignerSelectingOverlay above which
// covers both phases on the photo itself. The component is kept in
// the file (dead but exported-less) so a future revert is a quick
// re-add of the JSX call site rather than a re-implementation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CarouselRecommendingOverlay({
  phase,
}: {
  phase: 'analysing' | 'recommending';
}) {
  // Headline stays consistent across both phases ("design direction"
  // is the carousel area's job no matter which API call is running).
  // The step indicator + sub-line tell the user where we are in the
  // pipeline so the wait feels like progress, not a single long pause.
  const step = phase === 'analysing' ? 1 : 2;
  const sub =
    phase === 'analysing'
      ? 'Reading the room — light, flooring, architecture, existing colours. About 8 seconds.'
      : 'Picking the palette and trend that fit. About 10 seconds.';

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-ink/55 p-6 text-center backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-cream/40 bg-cream/10 backdrop-blur">
        <span aria-hidden className="animate-pulse text-cream text-[20px]">✦</span>
      </div>
      <p className="mt-4 font-dmmono text-[10px] uppercase tracking-eyebrow text-cream/75">
        Step {step} of 2
      </p>
      <p className="mt-2 font-display text-h3 leading-tight text-cream md:text-[24px]">
        Claude is thinking about your design direction…
      </p>
      <p className="mt-2 max-w-sm font-dmsans text-[13px] leading-relaxed text-cream/85 md:text-[14px]">
        {sub}
      </p>
      {/* Two-segment progress bar — first segment fills during
          analysing, second during recommending. Gives the user a
          visual sense of pipeline progress. */}
      <div className="mt-5 flex w-44 gap-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-cream/20">
          <div
            className={cn(
              'h-full rounded-full',
              phase === 'analysing' ? 'w-1/2 animate-pulse bg-clay' : 'w-full bg-cream/70',
            )}
          />
        </div>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-cream/20">
          <div
            className={cn(
              'h-full rounded-full',
              phase === 'recommending' ? 'w-1/2 animate-pulse bg-clay' : 'w-0',
            )}
          />
        </div>
      </div>
    </div>
  );
}

function Step2Review({
  analysis,
  confirmed,
  onConfirm,
  onEdit,
}: {
  analysis: RoomAnalysis;
  confirmed: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  return (
    <section>
      <Eyebrow>Step 02 · What Claude sees</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Confirm the room read</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
        We've grounded the restyle on these observations. Confirm to lock them in; the render
        prompt will preserve your architecture and existing flooring.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <FactCard label="Room">
          <p className="font-display text-h4 text-ink capitalize">
            {analysis.room_type?.replace(/_/g, ' ') ?? 'Unknown'}
          </p>
          {analysis.ceiling_height_m ? (
            <p className="mt-1 text-[14px] text-ink-soft">
              Approx. {analysis.ceiling_height_m}m ceilings
            </p>
          ) : null}
          {analysis.dimensions_approximate_m.width && analysis.dimensions_approximate_m.depth ? (
            <p className="mt-1 text-[14px] text-ink-soft">
              {analysis.dimensions_approximate_m.width}m × {analysis.dimensions_approximate_m.depth}m
            </p>
          ) : null}
        </FactCard>

        <FactCard label="Light">
          <p className="font-display text-h4 text-ink capitalize">
            {analysis.light.direction ? `${analysis.light.direction}-facing` : 'Direction unclear'}
          </p>
          {analysis.light.quality ? (
            <p className="mt-1 text-[14px] text-ink-soft">{analysis.light.quality}</p>
          ) : null}
        </FactCard>

        <FactCard label="Existing colours">
          <ul className="space-y-2">
            {analysis.existing_colours.slice(0, 4).map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-[14px] text-ink-soft">
                {c.hex ? (
                  <span
                    aria-hidden
                    style={{ background: c.hex }}
                    className="inline-block h-4 w-4 shrink-0 rounded-full border border-ink/10"
                  />
                ) : null}
                <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  {c.surface}
                </span>
                <span>{c.description}</span>
              </li>
            ))}
          </ul>
        </FactCard>

        <FactCard label="Architecture & flooring">
          {analysis.flooring ? (
            <p className="text-[14px] text-ink-soft">
              <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Floor ·{' '}
              </span>
              {analysis.flooring}
            </p>
          ) : null}
          {analysis.architectural_features.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis.architectural_features.slice(0, 6).map((f) => (
                <Pill key={f} tone="cream" size="sm">
                  {f}
                </Pill>
              ))}
            </div>
          ) : null}
        </FactCard>

        {analysis.existing_furniture.length > 0 ? (
          <FactCard label="Existing furniture" wide>
            <ul className="grid gap-2 sm:grid-cols-2">
              {analysis.existing_furniture.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-[14px] text-ink-soft">
                  <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                    {f.condition}
                  </span>
                  <span>{f.item}</span>
                </li>
              ))}
            </ul>
          </FactCard>
        ) : null}
      </div>

      {!confirmed ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" variant="cta" onClick={onConfirm}>
            Looks right · continue
          </Button>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            You'll be able to override the style next
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Pill tone="olive" withDot>Confirmed</Pill>
          <button
            type="button"
            onClick={onEdit}
            className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
          >
            Edit
          </button>
        </div>
      )}
    </section>
  );
}

function FactCard({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-ink/[0.06] bg-cream p-5',
        wide ? 'md:col-span-2' : '',
      )}
    >
      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Step5HeroProducts({
  products,
  loading,
  selectedIds,
  onToggle,
}: {
  products: FeaturedProduct[] | null;
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <Eyebrow>Step 05 · Feature products (optional)</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Bias the render toward real SKUs</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
        Pick up to 3 hero products from the AU catalogue. Their shape and palette will be woven
        into the Flux prompt so the render leans toward items you can actually buy. Skip to let
        the AI choose freely.
      </p>

      {loading || !products ? (
        <div className="mt-6 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 text-center">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Loading hero products…
          </p>
        </div>
      ) : products.length === 0 ? (
        <div className="mt-6 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 text-center">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            No matched products yet — proceed without featuring any.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => {
              const selected = selectedIds.includes(p.id);
              const disabled = !selected && selectedIds.length >= 3;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggle(p.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={cn(
                    'group flex flex-col gap-2 overflow-hidden rounded-xl border bg-cream text-left transition disabled:opacity-40',
                    selected ? 'border-clay shadow-soft' : 'border-ink/[0.06] hover:border-ink/20',
                  )}
                >
                  <div className="relative aspect-square w-full bg-paper-warm bg-grain">
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition group-hover:scale-[1.02]"
                      unoptimized
                    />
                    {selected ? (
                      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-clay font-mono text-meta text-paper">
                        {selectedIds.indexOf(p.id) + 1}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 font-display text-[14px] leading-tight text-ink">
                      {p.name}
                    </p>
                    <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      {p.retailer}
                    </p>
                    {p.price_aud != null ? (
                      <p className="mt-1 font-display text-h4 text-ink">
                        ${Math.round(p.price_aud).toLocaleString('en-AU')}
                      </p>
                    ) : (
                      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        POA
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {selectedIds.length} / 3 selected
          </p>
        </>
      )}
    </section>
  );
}

interface TrendPreview {
  paletteId: string;
  headline: string;
  roomType: string;
  matchedRoomType: boolean;
  imageUrl: string;
}

// --- Step 3 · Single palette picker with filter chips ----------------
//
// 2026-05-23 #168 — replaced the previous 3-carousel design (palette +
// 2026 trends + tried-and-tested with mutex) with one carousel and
// three filter chips. Reason: the old structure implied three
// independent choices when in reality all three carousels were
// sliced views of the same 56-palette catalogue and picking from
// the "trend" or "heritage" carousel just overwrote the pick from
// the main one. UX now matches the data model — one palette
// choice, filtered three ways. Trend-source provenance and the
// trend / heritage label live on every card.
//
// The currently-selected palette is always included in the rendered
// list, even when it's outside the active filter, so a user never
// loses their selection by switching filters.
type PaletteFilter = 'all' | 'trends' | 'timeless';

function Step3Style({
  paletteId,
  onPaletteChange,
  trendPreviews,
  flowMode,
}: {
  paletteId: string;
  onPaletteChange: (p: string) => void;
  trendPreviews: Map<string, TrendPreview>;
  flowMode: UploadFormMode;
}) {
  const [filter, setFilter] = useState<PaletteFilter>('all');
  // Mode B filters the picker to the 5 ultra-contemporary palettes
  // signed off 2026-05-26 (MODE_B_PALETTE_IDS in lib/palettes.ts).
  // Mode A retains the full 56-palette catalogue.
  const all = listPalettesForMode(flowMode);
  const filtered =
    filter === 'trends'
      ? all.filter(isTrendForward)
      : filter === 'timeless'
        ? all.filter(isTimeless)
        : all;
  // Always include the selected palette even when it sits outside the
  // active filter — switching filters should never make the user's
  // current pick vanish.
  const selectedPalette = all.find((p) => p.id === paletteId);
  const palettes =
    selectedPalette && !filtered.find((p) => p.id === paletteId)
      ? [selectedPalette, ...filtered]
      : filtered;

  return (
    <section>
      <Eyebrow>Step 03 · Colour palette</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">
        Pick the colour direction
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
        The full {all.length}-palette catalogue powers every render. Filter to a
        curated subset — 2026&rsquo;s trend leaders or heritage / classical
        frameworks — or browse them all. Pick one to set walls, floors, and the
        overall colour story.
      </p>

      <div
        className="mt-5 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Palette filters"
      >
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All · {all.length}
        </FilterChip>
        <FilterChip
          active={filter === 'trends'}
          onClick={() => setFilter('trends')}
        >
          2026 trends · {all.filter(isTrendForward).length}
        </FilterChip>
        <FilterChip
          active={filter === 'timeless'}
          onClick={() => setFilter('timeless')}
        >
          Tried &amp; tested · {all.filter(isTimeless).length}
        </FilterChip>
      </div>

      <div className="-mx-2 mt-6 overflow-x-auto pb-3 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-4 px-2">
          {palettes.map((p) => (
            <li
              key={p.id}
              className="snap-start shrink-0 basis-[280px] md:basis-[320px]"
            >
              <UnifiedPaletteCard
                palette={p}
                preview={trendPreviews.get(p.id)}
                selected={paletteId === p.id}
                onSelect={() => onPaletteChange(p.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-pill border px-4 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
        active
          ? 'border-clay bg-clay text-paper'
          : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

// Unified palette card — magazine-style. Hero is the pre-rendered
// trend image when available (preview.imageUrl, generated by the
// /api/trend-previews job), else falls back to a 5-column swatch
// strip. Bottom block always carries the trend / heritage label,
// palette name, vibe, and trend_source provenance line.
function UnifiedPaletteCard({
  palette: p,
  preview,
  selected,
  onSelect,
}: {
  palette: Palette;
  preview: TrendPreview | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const swatch = paletteSwatch(p);
  const tintCss = `linear-gradient(135deg, ${swatch[0] ?? '#F4EFE6'}1A 0%, ${swatch[2] ?? '#C4956A'}10 100%)`;
  const isTrend = isTrendForward(p);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ background: tintCss }}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition',
        selected
          ? 'border-clay shadow-soft ring-1 ring-clay/40'
          : 'border-ink/[0.06] hover:border-ink/20',
      )}
    >
      {preview?.imageUrl ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.imageUrl}
            alt={`${p.name} applied to a ${preview.roomType.replace(/_/g, ' ')}`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          {preview && !preview.matchedRoomType ? (
            <span className="absolute left-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-paper">
              {preview.roomType.replace(/_/g, ' ')} sample
            </span>
          ) : null}
          {selected ? (
            <span className="absolute right-2 top-2 rounded-full bg-clay px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-paper">
              ✓ Selected
            </span>
          ) : null}
        </div>
      ) : (
        <div className="relative grid h-32 grid-cols-5">
          {swatch.slice(0, 5).map((hex, i) => (
            <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
          ))}
          {selected ? (
            <span className="absolute right-2 top-2 rounded-full bg-clay px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-paper">
              ✓ Selected
            </span>
          ) : null}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-mono text-[10px] uppercase tracking-eyebrow text-clay">
          {isTrend ? '2026 trend' : 'Tried & tested'} · T {p.timelessness}/10
        </p>
        <p className="font-display text-[18px] leading-tight text-ink">
          {p.name}
        </p>
        <p className="line-clamp-2 text-[12px] leading-relaxed text-ink-soft">
          {p.vibe}
        </p>
        {p.trend_source ? (
          <p className="mt-auto line-clamp-1 font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
            {p.trend_source}
          </p>
        ) : null}
      </div>
    </button>
  );
}

// #179 — designer-curated picking step. Replaces the post-render
// Florence-2 picking flow with explicit user picks BEFORE the
// render. Each core category for the room (4 max — sofas, coffee
// tables, etc.) gets a horizontal row of 6-8 cards. Wishlist items
// are pinned to the front of each row with a ♥ marker. User picks
// up to N per category, where N comes from `pickCountForCategory`
// (1 for most categories, 2 for matching-pair categories like
// Bedside Tables / Table Lamps / Side Tables and variety categories
// like Dining Chair / Stool). The per-card hint shows the count
// ("Pick 1" / "Pick 2" / "1 of 2 picked"). Categories where the
// renderer naturally multiplies a single pick (dining chairs around
// a table, matching bedsides) still benefit from
// MULTI_INSTANCE_CATEGORIES in lib/openai-image.ts — picking 2
// Dining Chairs lets the user MIX styles in the rendered scene
// while picking 1 still gets multiplied into a coordinated set.
// Item passed into the picker UI. Mirror of CurationItem from
// lib/curation.ts (kept inline here so the file doesn't need a
// cross-cutting type import). The variant fields (variantGroupId /
// variantLabel / colourHex) drive A3's colour-swipe grouping —
// siblings of the same product share a variantGroupId and render as
// a single card with swatches.
interface PickerItem {
  id: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  isWishlisted: boolean;
  variantGroupId: string | null;
  variantLabel: string | null;
  colourHex: string | null;
}

// Group sibling variants (same variantGroupId) into single visual
// cards, preserving the first-occurrence order of each group. Items
// with null variantGroupId stay as their own group of one — the
// card renders identically to pre-A3 behaviour for them.
function groupVariants(items: PickerItem[]): PickerItem[][] {
  const result: PickerItem[][] = [];
  const groupIndex = new Map<string, number>();
  for (const item of items) {
    if (!item.variantGroupId) {
      result.push([item]);
      continue;
    }
    const existingIdx = groupIndex.get(item.variantGroupId);
    if (existingIdx !== undefined) {
      result[existingIdx]!.push(item);
    } else {
      groupIndex.set(item.variantGroupId, result.length);
      result.push([item]);
    }
  }
  return result;
}

function CurationStep({
  categories,
  picks,
  onTogglePick,
}: {
  categories: Array<{
    displayLabel: string;
    items: PickerItem[];
  }>;
  picks: Map<string, Set<string>>;
  onTogglePick: (categoryLabel: string, productId: string) => void;
}) {
  return (
    <section>
      <Eyebrow>The designer&rsquo;s edit · pick what you love</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Pick your products</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
        We&rsquo;ve narrowed the catalogue to what fits your palette + room. Each
        category shows how many to pick — usually one, sometimes two where the
        room calls for a matching pair or you might want to mix two styles.
        Items you&rsquo;ve liked before are pinned to the front of each row.
      </p>

      {categories.map((cat) => {
        const catPicks = picks.get(cat.displayLabel) ?? new Set();
        const maxN = pickCountForCategory(cat.displayLabel);
        const atCapacity = catPicks.size >= maxN;
        // Counter copy per state:
        //   - No catalogue matches in this palette
        //   - Empty: "Pick 1" / "Pick 2"
        //   - Partial (only relevant when maxN > 1): "1 of 2 picked"
        //   - Full + maxN=1: "Selected" (terse for the common case)
        //   - Full + maxN>1: "2 of 2 picked"
        const counter =
          cat.items.length === 0
            ? 'No matches'
            : catPicks.size === 0
              ? `Pick ${maxN}`
              : !atCapacity
                ? `${catPicks.size} of ${maxN} picked`
                : maxN === 1
                  ? 'Selected'
                  : `${catPicks.size} of ${maxN} picked`;
        return (
          <div key={cat.displayLabel} className="mt-8">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-display text-h4 text-ink">{cat.displayLabel}</h3>
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                {counter}
              </p>
            </div>

            {cat.items.length === 0 ? (
              <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                No catalogue matches in this palette — try another palette.
              </p>
            ) : (
              <div className="-mx-2 mt-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
                <ul className="flex snap-x snap-mandatory gap-3 px-2">
                  {groupVariants(cat.items).map((group) => (
                    <ProductCard
                      key={group[0]!.variantGroupId ?? group[0]!.id}
                      group={group}
                      catPicks={catPicks}
                      atCapacity={atCapacity}
                      onTogglePick={(productId) => onTogglePick(cat.displayLabel, productId)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ProductCard — picker tile for one product (or one group of colour
// siblings). Added A3 (2026-05-26) to support the variant-grouping
// UX: products that share a variant_group_id collapse into a single
// card with a colour-swatch strip; tapping a swatch swaps the
// displayed variant AND (if the previous variant was selected)
// transfers the pick to the new variant. Standalone products
// (variantGroupId === null) render identically to pre-A3 behaviour:
// no swatch row, single image, tap to toggle selection.
//
// Local state: `activeIdx` — index into the group array of the
// currently-displayed variant. Default = index of a wishlisted
// sibling if present, else 0. Reset when the parent re-renders with
// a different group (rare — palette change triggers a re-fetch).
function ProductCard({
  group,
  catPicks,
  atCapacity,
  onTogglePick,
}: {
  group: PickerItem[];
  catPicks: Set<string>;
  atCapacity: boolean;
  onTogglePick: (productId: string) => void;
}) {
  // Prefer a wishlisted sibling as the default-shown variant — the
  // user has signal they like that colour. Falls back to the first
  // item in the group when nothing's wishlisted.
  const wishlistedIdx = group.findIndex((g) => g.isWishlisted);
  const [activeIdx, setActiveIdx] = useState<number>(wishlistedIdx >= 0 ? wishlistedIdx : 0);
  const active = group[activeIdx] ?? group[0]!;
  const selected = catPicks.has(active.id);
  // Also consider the card "selected" when ANY sibling in the group
  // is picked — this is a visual safety net for the case where the
  // user picked variant A, then the active card index is variant B.
  // Without this the card border would show unselected even though
  // a sibling is in the picks set.
  const groupHasPick = group.some((g) => catPicks.has(g.id));
  // Disabled when at capacity AND no sibling in this group is
  // already picked. If a sibling IS picked, the card stays
  // interactive so the user can deselect or swap colours.
  const canPick = groupHasPick || !atCapacity;

  function handleCardTap() {
    if (!canPick) return;
    onTogglePick(active.id);
  }

  function handleSwatchTap(idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (idx === activeIdx) return;
    const wasSelected = catPicks.has(active.id);
    setActiveIdx(idx);
    // Transfer the pick to the new variant if the old one was
    // selected — saves a tap. The toggle is idempotent on the
    // outgoing variant (off) and applies to the incoming (on).
    if (wasSelected) {
      onTogglePick(active.id); // deselect outgoing
      onTogglePick(group[idx]!.id); // select incoming
    }
  }

  const hasVariants = group.length > 1;

  return (
    <li className="snap-start shrink-0 basis-[160px] md:basis-[200px]">
      <button
        type="button"
        onClick={handleCardTap}
        disabled={!canPick}
        aria-pressed={selected}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-cream text-left transition',
          groupHasPick
            ? 'border-clay shadow-soft ring-1 ring-clay/40'
            : canPick
              ? 'border-ink/[0.06] hover:border-ink/20'
              : 'border-ink/[0.06] opacity-40 cursor-not-allowed',
        )}
      >
        <div className="relative aspect-square w-full bg-paper-warm bg-grain">
          <Image
            src={active.imageUrl}
            alt={active.name}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
            unoptimized
          />
          {active.isWishlisted ? (
            <span
              aria-label="You liked this before"
              className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-cream/95 text-clay shadow-sm"
            >
              ♥
            </span>
          ) : null}
          {selected ? (
            <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-clay text-paper font-mono text-meta">
              ✓
            </span>
          ) : null}
        </div>
        <div className="p-3">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
            {active.retailer}
          </p>
          <p className="mt-1 line-clamp-2 font-dmsans text-[12px] leading-tight text-ink">
            {active.name}
          </p>
          {active.priceAud != null ? (
            <p className="mt-1 font-display text-[14px] text-ink">
              ${Math.round(active.priceAud).toLocaleString('en-AU')}
            </p>
          ) : null}
          {hasVariants ? (
            // Colour swatch row. Each swatch is its own button so
            // tapping swaps the active variant without toggling the
            // pick. stopPropagation on swatch handler prevents the
            // outer card's onClick from also firing.
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {group.map((sib, idx) => {
                const isActive = idx === activeIdx;
                const swatchColour = sib.colourHex ?? '#CCC';
                return (
                  <button
                    key={sib.id}
                    type="button"
                    onClick={(e) => handleSwatchTap(idx, e)}
                    title={sib.variantLabel ?? sib.name}
                    aria-label={`Switch to ${sib.variantLabel ?? sib.name}`}
                    className={cn(
                      'h-4 w-4 rounded-full border transition',
                      isActive
                        ? 'border-ink shadow-sm scale-110'
                        : 'border-ink/30 hover:border-ink/60',
                    )}
                    style={{ backgroundColor: swatchColour }}
                  />
                );
              })}
              {active.variantLabel ? (
                <span className="ml-1 font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
                  {active.variantLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

// Legacy PaletteCarousel + DirectionCarousel removed 2026-05-23 (#168)
// — replaced by Step3Style's single UnifiedPaletteCard with filter
// chips above. Old structure implied three orthogonal choices when
// all three carousels were filtered views of the same palette list.
