'use client';

// Three-carousel chooser (#126) — Step 3 of the project wizard, shown
// after Claude has returned a brief response.
//
//   ① COLOUR PALETTE          required, primary. All 16 palettes.
//                             Claude's recommended palette is pre-selected.
//                             Non-matching palettes (persona_fit overlap
//                             < 2 with Claude's recommendation) grey out.
//                             User can scroll + override.
//
//   ② 2026 DESIGN TRENDS      optional, mutex with ③. The 10 trend-
//                             forward palettes (timelessness < 7).
//                             Picking here syncs the palette in ①.
//                             Greys ③ entirely.
//
//   ③ TRIED & TESTED          optional, mutex with ②. The 6 timeless
//                             palettes (timelessness >= 7). Federation,
//                             Hamptons Heritage, Mid-Century Walnut,
//                             Coastal Whitewash, English Country,
//                             Modernist Restraint. Picking here syncs
//                             the palette in ① and greys ② entirely.
//
// The chooser's job is to LET THE USER LOCK IN a palette (+ optional
// direction). It doesn't render. The render kickoff lives on the
// "Generate render" CTA the wizard owns — the chooser just calls
// onSelectionChange with the current pick.
//
// #127 will add a confirmation modal when the user picks something in
// Claude's `avoid` array.

import { useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { Pill } from '@/components/saltbush/pill';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import type { BriefPaletteLookup, BriefStyleLookup } from '@/components/projects/brief-picker';
import type { BriefSynthesis } from '@/lib/brief/synthesiser';

export type DirectionChoice = 'trends' | 'tried' | null;

export interface CarouselSelection {
  paletteId: string;
  direction: DirectionChoice;
}

interface ChooserProps {
  briefResponse: BriefSynthesis;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
  /** Pre-rendered trend-card images keyed by `${paletteId}__${roomType}`
   *  so each carousel card can show the palette applied to a room. The
   *  room defaults to `living_room` if the project's analysed room type
   *  doesn't have a card. */
  trendCardImages: Record<string, string | null>;
  /** Project's analysed room type so carousels show palette-in-room
   *  visuals from the right room when available. */
  roomType: string | null;
  /** Fires whenever the user changes their pick. The parent wizard
   *  uses this to enable/disable the "Generate render" CTA and to
   *  detect avoid-list overrides (#127). */
  onSelectionChange: (selection: CarouselSelection) => void;
}

const TIMELESS_THRESHOLD = 7;

export function WizardCarouselChooser({
  briefResponse,
  palettes,
  styles,
  trendCardImages,
  roomType,
  onSelectionChange,
}: ChooserProps) {
  const recommended = briefResponse.recommendation;
  const recommendedPalette = palettes.find((p) => p.id === recommended.palette_id);

  const trendPalettes = useMemo(
    () => palettes.filter((p) => (p.timelessness ?? 5) < TIMELESS_THRESHOLD),
    [palettes],
  );
  const timelessPalettes = useMemo(
    () => palettes.filter((p) => (p.timelessness ?? 5) >= TIMELESS_THRESHOLD),
    [palettes],
  );

  // Default direction inferred from the recommended palette's
  // timelessness bucket. Heritage/timeless personas land on ③ first,
  // trend-forward personas land on ②.
  const recommendedDirection: DirectionChoice = recommendedPalette
    ? (recommendedPalette.timelessness ?? 5) >= TIMELESS_THRESHOLD
      ? 'tried'
      : 'trends'
    : null;

  const [paletteId, setPaletteId] = useState<string>(recommended.palette_id);
  const [direction, setDirection] = useState<DirectionChoice>(recommendedDirection);

  // Avoid-set used for the confirmation modal in #127. We surface it
  // here too as a small "Designer flagged this" pill on greyed cards
  // that Claude explicitly warned against.
  //
  // Defensive — older briefs persisted before the synthesiser always
  // returned an `avoid` array could store undefined here. Coalesce to
  // an empty array so the chooser still renders without throwing on
  // briefResponse.avoid.map(...).
  const avoidPaletteIds = useMemo(
    () =>
      new Set(
        (briefResponse.avoid ?? [])
          .map((a) => a.palette_id)
          .filter((id): id is string => !!id),
      ),
    [briefResponse.avoid],
  );

  // Persona fit overlap between Claude's recommendation and a
  // candidate palette. 0-4. < 2 → grey out as "not aligned".
  const recommendedFit = useMemo(
    () => new Set(recommendedPalette?.persona_fit ?? []),
    [recommendedPalette],
  );
  function paletteFitScore(p: BriefPaletteLookup): number {
    if (!p.persona_fit) return 0;
    let count = 0;
    for (const axis of p.persona_fit) if (recommendedFit.has(axis)) count++;
    return count;
  }

  function emit(nextPaletteId: string, nextDirection: DirectionChoice) {
    setPaletteId(nextPaletteId);
    setDirection(nextDirection);
    onSelectionChange({ paletteId: nextPaletteId, direction: nextDirection });
  }

  function onPickPalette(p: BriefPaletteLookup) {
    // Picking directly in carousel ① keeps the current direction
    // commitment. If the user previously picked a 2026 direction and
    // now picks a timeless palette directly, they stay committed to
    // 2026 unless they explicitly switch via carousel ②/③.
    emit(p.id, direction);
  }
  function onPickTrend(p: BriefPaletteLookup) {
    emit(p.id, 'trends');
  }
  function onPickTimeless(p: BriefPaletteLookup) {
    emit(p.id, 'tried');
  }

  return (
    <div className="space-y-10">
      {/* Designer narrative — the brief response context lives here
          as the framing for the carousels below. */}
      <BriefRecommendationSummary
        response={briefResponse}
        recommendedPalette={recommendedPalette}
        recommendedStyle={styles.find((s) => s.slug === recommended.style_slug) ?? null}
      />

      <PaletteCarousel
        anchor="palette"
        label="① Colour palette"
        required
        intro="The colour story for your render. Pick one — Claude's recommendation is highlighted."
        palettes={palettes}
        selectedId={paletteId}
        recommendedId={recommended.palette_id}
        avoidIds={avoidPaletteIds}
        fitScore={paletteFitScore}
        roomType={roomType}
        trendCardImages={trendCardImages}
        onPick={onPickPalette}
        disabled={false}
      />

      <PaletteCarousel
        anchor="trends"
        label="② 2026 design trends"
        intro="Trend-led furnishing direction this year. Optional — pick one OR a tried-and-tested direction below, not both."
        palettes={trendPalettes}
        selectedId={direction === 'trends' ? paletteId : null}
        recommendedId={recommended.palette_id}
        avoidIds={avoidPaletteIds}
        fitScore={paletteFitScore}
        roomType={roomType}
        trendCardImages={trendCardImages}
        onPick={onPickTrend}
        disabled={direction === 'tried'}
        disabledReason="Pick from Tried & Tested first, or clear that direction."
        showVariant
      />

      <PaletteCarousel
        anchor="tried"
        label="③ Tried & tested directions"
        intro="Heritage, classic, modernist frameworks. Optional — durable choices that don't date."
        palettes={timelessPalettes}
        selectedId={direction === 'tried' ? paletteId : null}
        recommendedId={recommended.palette_id}
        avoidIds={avoidPaletteIds}
        fitScore={paletteFitScore}
        roomType={roomType}
        trendCardImages={trendCardImages}
        onPick={onPickTimeless}
        disabled={direction === 'trends'}
        disabledReason="Pick from 2026 trends first, or clear that direction."
        showVariant
      />

      {direction !== null ? (
        <div className="flex items-center gap-3">
          <Pill tone="cream" size="sm">
            Direction committed · {direction === 'trends' ? '2026 trends' : 'Tried & tested'}
          </Pill>
          <button
            type="button"
            onClick={() => emit(paletteId, null)}
            className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
          >
            Clear direction (palette only)
          </button>
        </div>
      ) : null}
    </div>
  );
}

// --- Recommendation summary card -----------------------------------------

function BriefRecommendationSummary({
  response,
  recommendedPalette,
  recommendedStyle,
}: {
  response: BriefSynthesis;
  recommendedPalette: BriefPaletteLookup | undefined;
  recommendedStyle: BriefStyleLookup | null;
}) {
  return (
    <article className="rounded-2xl border border-clay/30 bg-paper-warm bg-grain p-6 md:p-8">
      <Eyebrow>Designer recommendation</Eyebrow>
      <p className="mt-3 max-w-2xl font-display text-[20px] leading-snug text-ink">
        {response.what_you_said}
      </p>

      {recommendedPalette ? (
        <div className="mt-6 flex flex-wrap items-center gap-5 rounded-xl border border-clay/30 bg-cream p-5">
          <div className="w-44 shrink-0">
            <PaletteStrip colors={recommendedPalette.swatch} className="h-8" />
          </div>
          <div>
            <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
              I'd recommend
            </p>
            <p className="mt-1 font-display text-h3 text-ink">{recommendedPalette.name}</p>
            {recommendedStyle ? (
              <p className="mt-1 font-display italic text-ink-soft">
                with {recommendedStyle.name}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {recommendedPalette.timelessness !== undefined ? (
                <Pill
                  tone={recommendedPalette.timelessness >= TIMELESS_THRESHOLD ? 'olive' : 'clay'}
                  size="sm"
                >
                  Timelessness {recommendedPalette.timelessness}/10
                </Pill>
              ) : null}
              {recommendedPalette.persona_fit?.slice(0, 3).map((axis) => (
                <Pill key={axis} tone="cream" size="sm">
                  {axis}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-ink">
        {response.recommendation.reasoning}
      </p>

      {response.push_back ? (
        <div className="mt-6 border-l-2 border-clay/40 pl-4">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            One thing I'd push back on
          </p>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink">
            {response.push_back.concern}
          </p>
        </div>
      ) : null}
    </article>
  );
}

// --- Carousel ------------------------------------------------------------

interface CarouselProps {
  anchor: string;
  label: string;
  intro: string;
  palettes: BriefPaletteLookup[];
  selectedId: string | null;
  recommendedId: string;
  avoidIds: Set<string>;
  fitScore: (p: BriefPaletteLookup) => number;
  roomType: string | null;
  trendCardImages: Record<string, string | null>;
  onPick: (p: BriefPaletteLookup) => void;
  disabled: boolean;
  disabledReason?: string;
  required?: boolean;
  /** When true, render the room-visual variant (uses trendCardImages).
   *  When false, render the colour-swatch variant. */
  showVariant?: boolean;
}

function PaletteCarousel({
  anchor,
  label,
  intro,
  palettes,
  selectedId,
  recommendedId,
  avoidIds,
  fitScore,
  roomType,
  trendCardImages,
  onPick,
  disabled,
  disabledReason,
  required,
  showVariant,
}: CarouselProps) {
  return (
    <section id={`carousel-${anchor}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Eyebrow>{label}{required ? ' · required' : ' · optional'}</Eyebrow>
          <p className="mt-1 max-w-2xl text-[14px] text-ink-soft">{intro}</p>
        </div>
        {disabled ? (
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {disabledReason ?? 'Mutually exclusive'}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          '-mx-2 mt-5 overflow-x-auto pb-3 [scrollbar-width:thin] transition',
          disabled ? 'pointer-events-none opacity-30' : '',
        )}
      >
        <ul className="flex snap-x snap-mandatory gap-4 px-2">
          {palettes.map((p) => {
            const isSelected = selectedId === p.id;
            const isRecommended = recommendedId === p.id;
            const isAvoid = avoidIds.has(p.id);
            const score = fitScore(p);
            const isLowFit = !isRecommended && score < 2;
            return (
              <li
                key={p.id}
                className="snap-start shrink-0 basis-[240px] md:basis-[280px]"
              >
                <PaletteCard
                  palette={p}
                  selected={isSelected}
                  recommended={isRecommended}
                  avoid={isAvoid}
                  lowFit={isLowFit}
                  variant={showVariant ? 'visual' : 'swatch'}
                  imageUrl={
                    showVariant
                      ? trendCardImages[`${p.id}__${roomType ?? 'living_room'}`] ??
                        trendCardImages[`${p.id}__living_room`] ??
                        null
                      : null
                  }
                  onPick={() => onPick(p)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function PaletteCard({
  palette,
  selected,
  recommended,
  avoid,
  lowFit,
  variant,
  imageUrl,
  onPick,
}: {
  palette: BriefPaletteLookup;
  selected: boolean;
  recommended: boolean;
  avoid: boolean;
  lowFit: boolean;
  variant: 'swatch' | 'visual';
  imageUrl: string | null;
  onPick: () => void;
}) {
  // Greying: lowFit cards (no persona overlap with Claude's pick)
  // drop to 50% opacity but stay clickable + scrollable. Avoid cards
  // get the lowFit treatment PLUS a "Designer flagged" pill.
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        'group relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border bg-cream text-left transition',
        selected
          ? 'border-clay/60 shadow-soft ring-2 ring-clay/30'
          : 'border-ink/[0.06] hover:border-ink/20',
        lowFit ? 'opacity-50 hover:opacity-80' : 'opacity-100',
      )}
    >
      {variant === 'visual' && imageUrl ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/[0.04]">
          <Image
            src={imageUrl}
            alt={`${palette.name} applied to a room`}
            fill
            sizes="280px"
            className="object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/[0.04]">
          <PaletteStrip
            colors={palette.swatch}
            className="absolute inset-0 h-full w-full"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {recommended ? (
            <span className="rounded-pill bg-clay/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-clay">
              Recommended
            </span>
          ) : null}
          {avoid ? (
            <span className="rounded-pill bg-destructive/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
              Designer flagged
            </span>
          ) : null}
          {palette.timelessness !== undefined ? (
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
              T {palette.timelessness}/10
            </span>
          ) : null}
        </div>
        <p className="font-display text-h4 text-ink">{palette.name}</p>
        <p className="line-clamp-2 text-[12px] text-ink-soft">{palette.vibe}</p>
        {variant === 'swatch' ? (
          <PaletteStrip colors={palette.swatch} className="mt-1 h-5" />
        ) : null}
      </div>
    </button>
  );
}

export function _unused(): ReactNode {
  return null;
}
