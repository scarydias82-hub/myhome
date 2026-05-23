'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Pill } from '@/components/saltbush/pill';
import { type StyleSlug } from '@/lib/styles';
import {
  isTrendForward,
  isTimeless,
  listPalettes,
  paletteDirection,
  paletteSwatch,
  type Palette,
} from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';
import { cn } from '@/lib/utils';
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

export function UploadForm({ projectId }: { projectId?: string | null }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RoomAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  // Phase 2 of the photo flow (#143). Set true after vision returns
  // and we kick off /api/recommend; flipped back to false when the
  // recommendation arrives (or fails). Drives the overlay on the
  // carousels — distinct from `analysing` which drives the overlay
  // on the photo.
  const [recommending, setRecommending] = useState(false);
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false);

  const [style, setStyle] = useState<StyleSlug>('japandi');
  const [paletteId, setPaletteId] = useState<string>(listPalettes()[0]?.id ?? '');
  // Direction state — mirrors the dashboard's two extra carousels. The
  // colour palette (above) is required; direction is optional. Picking
  // in carousel ② sets direction='2026', picking in ③ sets
  // direction='timeless'. Mutex: choosing one clears the other.
  const [direction, setDirection] = useState<'2026' | 'timeless' | null>(null);
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
          // Auto-derive direction from the recommended palette's
          // timelessness via the shared paletteDirection() helper —
          // single source of truth for the trend / heritage split
          // (#167). The user can still clear or swap; this just
          // matches what the brief synthesiser intended.
          const recommended = listPalettes().find((p) => p.id === rec.palette_id);
          const dir = paletteDirection(recommended);
          if (dir) setDirection(dir);
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

  async function handleFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      setPreview(null);
      setRoomId(null);
      setAnalysis(null);
      setAnalysisConfirmed(false);
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
    setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', photoFile);
      if (projectId) fd.append('projectId', projectId);
      const res = await fetch('/api/analyse-room', { method: 'POST', body: fd });
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
      setDirection(rec.direction);
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
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, style, paletteId, featuredProductIds: featuredIds, projectId: projectId ?? undefined }),
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
        analysing={analysing}
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

      {/* DesignerSummaryCard only renders when we have analysis data
          (Phase 1 done). Commentary inside the card progressively
          reveals — room read first, then the "why" once Phase 2 is
          done. */}
      {analysisConfirmed && analysis ? (
        <DesignerSummaryCard
          analysis={analysis}
          briefPreFilled={briefPreFilled}
          paletteId={paletteId}
          direction={direction}
          reasoning={recommendationReasoning}
        />
      ) : null}

      {/* §6.11 Phase C (#155) — inheritance banner. Shows where the
          recommendation's taste signal came from (project / user_prefs /
          override) and offers the "Customise for this image" override.
          Hidden when there's nothing to say (no recommendation yet, or
          source is 'none' — the cold-start case we still allow). */}
      {analysisConfirmed && roomId && recommendationSource && recommendationSource !== 'none' ? (
        <RecommendationSourceBanner
          source={recommendationSource}
          appliedTags={appliedTags}
          tagLabelBySlug={TAG_LABEL_BY_SLUG}
          onCustomise={() => setOverrideOpen(true)}
          onClear={recommendationSource === 'override' ? clearOverride : undefined}
        />
      ) : null}

      {/* Carousels mount as soon as analysis kicks off — not waiting
          for Phase 1 to complete. Single carousel overlay spans
          BOTH phases (analysing + recommending) so the user sees
          the destination they're heading toward while Claude works.
          The relative wrapper anchors the overlay to this region
          only — photo overlay above stays in place during Phase 1,
          photo becomes interactive again in Phase 2. */}
      {analysing || analysisConfirmed ? (
        <div className="relative">
          <Step3Style
            paletteId={paletteId}
            onPaletteChange={setPaletteId}
            direction={direction}
            onDirectionChange={(next) => {
              // Mutex behaviour: setting direction='2026' clears any
              // previous timeless pick (and vice versa). Setting to
              // null clears either. The paletteId is updated by the
              // caller via onPaletteChange when a direction card is
              // tapped — those carousels are palette-backed, so
              // picking a direction card IS picking that palette.
              setDirection(next);
            }}
            trendPreviews={trendPreviews}
          />
          {analysing || recommending ? (
            <CarouselRecommendingOverlay phase={analysing ? 'analysing' : 'recommending'} />
          ) : null}
        </div>
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

      <div className="flex items-center gap-4">
        <Button
          type="submit"
          variant="cta"
          size="lg"
          disabled={!analysisConfirmed || submitting || converting || analysing || recommending}
        >
          {submitting ? 'Restyling… (~30s)' : 'Restyle the room'}
        </Button>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Grounded by Claude vision · rendered with Flux + canny
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
  analysing,
  onPick,
  onBrowseFiles,
}: {
  file: File | null;
  preview: string | null;
  converting: boolean;
  analysing: boolean;
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
            {/* Analysing overlay — sits ON the photo so the Claude
                vision call feels like the designer leaning in to
                inspect the room, rather than a generic "loading"
                placeholder elsewhere on the page. */}
            {analysing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink/55 p-6 text-center backdrop-blur-sm">
                <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-cream/40 bg-cream/10 backdrop-blur">
                  <span aria-hidden className="animate-pulse text-cream text-[20px]">◎</span>
                </div>
                <p className="mt-4 font-display text-h3 leading-tight text-cream md:text-[24px]">
                  We&rsquo;re waiting for the designer&rsquo;s opinion…
                </p>
                <p className="mt-2 max-w-sm font-dmsans text-[13px] leading-relaxed text-cream/85 md:text-[14px]">
                  Claude is reading the light, the flooring, the architecture and the colour
                  story of this room — about 8 seconds.
                </p>
                <div className="mt-5 h-1 w-44 overflow-hidden rounded-full bg-cream/20">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onBrowseFiles}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-pill border border-ink/15 bg-cream/95 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft shadow-sm backdrop-blur transition hover:border-clay/40 hover:text-clay"
              >
                Replace photo
              </button>
            )}
            {file && !analysing ? (
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
  direction,
  reasoning,
}: {
  analysis: RoomAnalysis | null;
  briefPreFilled: boolean;
  paletteId: string;
  direction: '2026' | 'timeless' | null;
  /** Optional 1-2 sentence "why" from Claude's room-grounded
   *  recommendation. Surfaced under the palette name so the user
   *  sees what drove the pick. */
  reasoning?: string | null;
}) {
  const palette = listPalettes().find((p) => p.id === paletteId) ?? null;

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
          Sits directly under the room read so the editorial logic
          reads as one breath: ROOM → WHY → WHAT. When the
          recommendation hasn't landed yet (Phase 2 still running)
          we show a placeholder line so the layout doesn't jump. */}
      <p className="mt-3 font-dmsans text-[14px] leading-relaxed text-ink md:text-[15px]">
        {reasoning ?? (
          <span className="text-ink-faint italic">
            Designer&rsquo;s reasoning is coming together — watch the carousels below.
          </span>
        )}
      </p>

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

function AnalysingPlaceholder() {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 text-center">
      <div className="mx-auto h-3 w-40 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
      </div>
      <p className="mt-4 font-display text-h4 text-ink">Claude is reading your room…</p>
      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        Vision · ~8s
      </p>
    </div>
  );
}

// CarouselRecommendingOverlay (#143/#144) — sits over the 3
// carousels across BOTH phases of the photo flow:
//   phase='analysing'    → vision is still running; the carousels
//                          are visible as the upcoming decision but
//                          locked while Claude reads the room
//   phase='recommending' → vision is done; synthesiser is picking
//                          a palette + direction
//
// Same visual treatment across both phases — only the headline copy
// shifts — so the user sees one continuous "Claude is working"
// overlay rather than two disjoint spinners. ink/55 + backdrop-blur
// mirrors the photo overlay above so both surfaces read as one
// design language.
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

// --- Step 3 · 3-carousel chooser ---------------------------------------
//
// Mirrors the dashboard's TrendsSection layout one-for-one so users see
// the same affordance in both surfaces: pure palette swatches first,
// then two optional direction carousels (2026 / Tried & tested).
//
// Hierarchy is deliberate:
//   ① Colour palettes      — required, sets walls/floors/tones
//   ② 2026 Design Trends   — optional, sets decorative direction
//   ③ Tried & tested       — optional, mutex with ②
//
// Picking in ② or ③ also updates the selected palette in ① (they're
// palette-backed — a "2026 Trend" IS one of the 10 trend-forward
// palettes presented with its trend-card hero image). The mutex
// between ② and ③ enforces "one direction at most" so the prompt
// doesn't get pulled in two heritage/contemporary directions.
function Step3Style({
  paletteId,
  onPaletteChange,
  direction,
  onDirectionChange,
  trendPreviews,
}: {
  paletteId: string;
  onPaletteChange: (p: string) => void;
  direction: '2026' | 'timeless' | null;
  onDirectionChange: (d: '2026' | 'timeless' | null) => void;
  trendPreviews: Map<string, TrendPreview>;
}) {
  const all = listPalettes();
  // Carousel splits use the same single source of truth as
  // paletteDirection() — `lib/palettes.ts` constant TRENDS_CUTOFF.
  const trendForward = all.filter(isTrendForward);
  const timeless = all.filter(isTimeless);

  return (
    <>
      {/* ① Colour palettes — required */}
      <PaletteCarousel
        eyebrow="Step 03 · Colour palette"
        title="Pick the colour direction"
        intro="The full 16-palette set behind every render. Walls, floors and overall room tone draw from this — required."
        palettes={all}
        selectedId={paletteId}
        onSelect={(pid) => {
          onPaletteChange(pid);
          // If the user picks a palette that doesn't belong to the
          // currently-active direction carousel, clear the direction
          // — keeps state coherent rather than leaving an orphan
          // selection in ② or ③.
          if (direction === '2026' && !trendForward.find((p) => p.id === pid)) {
            onDirectionChange(null);
          } else if (direction === 'timeless' && !timeless.find((p) => p.id === pid)) {
            onDirectionChange(null);
          }
        }}
      />

      {/* ② 2026 Design Trends — optional, mutex with ③ */}
      <DirectionCarousel
        eyebrow="Step 04 · 2026 Design Trends (optional)"
        title="Add a 2026 trend direction"
        intro="Curated from WGSN, Pantone, Benjamin Moore, Sherwin-Williams, Dulux AU and the year's dominant designer voices. Pick one to seed the decorative direction — or skip."
        palettes={trendForward}
        trendPreviews={trendPreviews}
        selectedPaletteId={direction === '2026' ? paletteId : null}
        otherDirectionActive={direction === 'timeless'}
        onSelect={(pid) => {
          if (pid === null) {
            onDirectionChange(null);
          } else {
            onPaletteChange(pid);
            onDirectionChange('2026');
          }
        }}
        emptyCopy="Loading trend previews…"
      />

      {/* ③ Tried & tested directions — optional, mutex with ② */}
      <DirectionCarousel
        eyebrow="Step 05 · Tried & tested (optional)"
        title="Or pick a heritage / classic direction"
        intro="Heritage, classic and modernist frameworks — durable colour stories grounded in Federation, Hamptons, Mid-Century and modernist principles. Choose this OR a 2026 trend, not both."
        palettes={timeless}
        trendPreviews={trendPreviews}
        selectedPaletteId={direction === 'timeless' ? paletteId : null}
        otherDirectionActive={direction === '2026'}
        onSelect={(pid) => {
          if (pid === null) {
            onDirectionChange(null);
          } else {
            onPaletteChange(pid);
            onDirectionChange('timeless');
          }
        }}
        emptyCopy="Loading tried-and-tested previews…"
      />
    </>
  );
}

// Pure colour palette carousel — swatch-led cards, no room hero image.
// Mirrors the dashboard PaletteCarousel visually but the cards are
// selectable buttons rather than navigation links.
function PaletteCarousel({
  eyebrow,
  title,
  intro,
  palettes,
  selectedId,
  onSelect,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  palettes: Palette[];
  selectedId: string;
  onSelect: (paletteId: string) => void;
}) {
  return (
    <section>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">{title}</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">{intro}</p>
      <div className="-mx-2 mt-6 overflow-x-auto pb-3 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-4 px-2">
          {palettes.map((p) => {
            const selected = selectedId === p.id;
            const swatch = paletteSwatch(p);
            const tintCss = `linear-gradient(135deg, ${swatch[0] ?? '#F4EFE6'}1A 0%, ${swatch[2] ?? '#C4956A'}10 100%)`;
            return (
              <li
                key={p.id}
                className="snap-start shrink-0 basis-[240px] md:basis-[280px]"
              >
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-pressed={selected}
                  style={{ background: tintCss }}
                  className={cn(
                    'flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition',
                    selected
                      ? 'border-clay shadow-soft ring-1 ring-clay/40'
                      : 'border-ink/[0.06] hover:border-ink/20',
                  )}
                >
                  <div className="grid h-32 grid-cols-5">
                    {swatch.slice(0, 5).map((hex, i) => (
                      <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
                    ))}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
                      T {p.timelessness}/10 · {p.persona_fit.slice(0, 2).join(' · ')}
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
                    {selected ? (
                      <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-clay px-3 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-paper">
                        ✓ Selected
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// Direction carousel — palette-backed cards with the pre-rendered Flux
// trend image as the hero. Used for both the 2026 carousel and the
// Tried & tested carousel; the only difference is the slice of
// palettes each gets.
function DirectionCarousel({
  eyebrow,
  title,
  intro,
  palettes,
  trendPreviews,
  selectedPaletteId,
  otherDirectionActive,
  onSelect,
  emptyCopy,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  palettes: Palette[];
  trendPreviews: Map<string, TrendPreview>;
  selectedPaletteId: string | null;
  otherDirectionActive: boolean;
  onSelect: (paletteId: string | null) => void;
  emptyCopy: string;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-2 font-display text-h3 text-ink">{title}</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">{intro}</p>
        </div>
        {selectedPaletteId ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-pill border border-ink/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink"
          >
            Clear direction
          </button>
        ) : null}
      </div>

      {/* Greyed-out hint when the OTHER direction carousel is active.
          Cards still scroll but interactions feel "locked" until the
          user clears that direction, so they understand the mutex. */}
      {otherDirectionActive ? (
        <p className="mt-3 rounded-lg border border-ink/[0.06] bg-paper-warm bg-grain px-4 py-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Another direction is selected. Clear it above to pick from this carousel.
        </p>
      ) : null}

      {palettes.length === 0 ? (
        <p className="mt-6 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {emptyCopy}
        </p>
      ) : (
        <div className="-mx-2 mt-6 overflow-x-auto pb-3 [scrollbar-width:thin]">
          <ul className="flex snap-x snap-mandatory gap-4 px-2">
            {palettes.map((p) => {
              const selected = selectedPaletteId === p.id;
              const preview = trendPreviews.get(p.id);
              const swatch = paletteSwatch(p);
              const tintCss = `linear-gradient(135deg, ${swatch[0] ?? '#F4EFE6'}1A 0%, ${swatch[2] ?? '#C4956A'}10 100%)`;
              return (
                <li
                  key={p.id}
                  className="snap-start shrink-0 basis-[280px] md:basis-[320px]"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    aria-pressed={selected}
                    disabled={otherDirectionActive}
                    style={{ background: tintCss }}
                    className={cn(
                      'flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition',
                      selected
                        ? 'border-clay shadow-soft ring-1 ring-clay/40'
                        : 'border-ink/[0.06] hover:border-ink/20',
                      otherDirectionActive && !selected
                        ? 'opacity-40 cursor-not-allowed hover:border-ink/[0.06]'
                        : '',
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/5">
                      {preview?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview.imageUrl}
                          alt={`${p.name} applied to a ${preview.roomType.replace(/_/g, ' ')}`}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center">
                          <div className="w-2/3">
                            <PaletteStrip colors={swatch} className="h-7" />
                          </div>
                        </div>
                      )}
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
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
                        T {p.timelessness}/10 · {p.persona_fit.slice(0, 2).join(' · ')}
                      </p>
                      <p className="font-display text-[18px] leading-tight text-ink">
                        {p.name}
                      </p>
                      <PaletteStrip colors={swatch} className="mt-1 h-5" />
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
