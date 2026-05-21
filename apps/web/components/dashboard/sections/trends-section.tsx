'use client';

// Trends section — two horizontal carousels.
//
// Until #118 (persona metadata) landed, every palette was 2026-trend-
// forward and a single feed made sense. With Layer 3a we added 6
// timeless palettes (Federation, Hamptons Heritage, Mid-Century Walnut,
// Coastal Whitewash, English Country, Modernist Restraint) which sit
// editorially apart from the 2026 picks. Stacking them in one feed
// confused the read; splitting them into two carousels with citation
// intros tells the user clearly: "this is what's hot now" vs "this is
// what doesn't date".
//
// Bucket logic: timelessness >= 7 → Timeless directions. < 7 → 2026.
// Threshold tuned to split the current 16-palette set into 10 trend +
// 6 timeless (matches the editorial intent of the Layer 3 expansion).
//
// Default order: 2026 first, Timeless below. Persona-aware reordering
// (when the user has a brief) is a future enhancement — for now the
// static default reflects the homepage's existing positioning.

import Link from 'next/link';
import Image from 'next/image';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { PaletteStrip } from '@/components/dashboard/shared/palette-strip';

export interface DashboardTrendCard {
  id: string;
  headline: string;
  paletteName: string;
  paletteHexes: string[];
  roomType: string;
  season: string; // e.g. "2026 · Dulux"
  description: string;
  matchNote: string | null; // computed from user's boards
  imageUrl: string;
  paletteId: string;
  /** Persona-metadata from palettes.json. 1 = trend, 10 = timeless.
   *  Drives the carousel bucket assignment. */
  timelessness: number;
}

export interface DashboardPaletteCard {
  id: string;
  name: string;
  vibe: string;
  trendSource: string;
  swatchHexes: string[];
  timelessness: number;
  personaFit: string[];
  recommendedRooms: string[];
}

interface TrendsSectionProps {
  trends: DashboardTrendCard[];
  /** Pure palette swatches — the 16 palettes shown as colour cards
   *  rather than rendered-in-room visuals. Mirrors the wizard's
   *  Step 3 "① Colour palette" carousel so the dashboard has a way
   *  to browse colour directly. */
  palettes: DashboardPaletteCard[];
}

const TIMELESS_THRESHOLD = 7;

export function TrendsSection({ trends, palettes }: TrendsSectionProps) {
  const trendForward = trends.filter((t) => (t.timelessness ?? 5) < TIMELESS_THRESHOLD);
  const timeless = trends.filter((t) => (t.timelessness ?? 5) >= TIMELESS_THRESHOLD);

  return (
    <section id="trends" className="py-10">
      {/* ① Colour palette carousel — pure palette browsing, mirrors
          the wizard Step 3 primary chooser. Lets users scan the 16
          palette options without committing to a room-applied
          visual. */}
      <PaletteCarousel
        anchor="palettes"
        title="Colour palettes"
        intro="The full 16-palette set behind every render. Hover a card to see the trend source; click through to use one as the basis for your next project."
        palettes={palettes}
      />

      {/* ② 2026 Design Trends carousel — what's hot this year, sourced
          from WGSN, Pantone, Benjamin Moore, Sherwin-Williams, Dulux AU
          et al. Dedup-by-palette upstream means each trend-forward
          palette (timelessness < 7) gets exactly one card here. */}
      <TrendsCarousel
        anchor="trends-2026"
        title="2026 Design Trends"
        intro="Curated from WGSN, Pantone, Benjamin Moore, Sherwin-Williams, Dulux AU, and the year's dominant designer voices."
        cards={trendForward}
        emptyCopy="Trend cards are still generating — check back in a few minutes."
      />

      {/* ③ Timeless carousel — heritage / classic / modernist frameworks
          that aren't year-bound. Surfaces the Layer 3 expansion. */}
      <TrendsCarousel
        anchor="trends-timeless"
        title="Tried & tested directions"
        intro="Heritage, classic and modernist frameworks — durable colour stories grounded in Federation, Hamptons, Mid-Century and modernist principles."
        cards={timeless}
        emptyCopy="Timeless trend cards are still generating."
      />
    </section>
  );
}

// --- Colour palette carousel (pure swatch view) --------------------------

function PaletteCarousel({
  anchor,
  title,
  intro,
  palettes,
}: {
  anchor: string;
  title: string;
  intro: string;
  palettes: DashboardPaletteCard[];
}) {
  return (
    <section id={anchor} className="mb-12">
      <SectionHeader
        title={title}
        action={{ label: 'See all →', href: `/dashboard#${anchor}` }}
      />
      <p className="mt-2 max-w-3xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
        {intro}
      </p>
      {palettes.length === 0 ? (
        <p className="mt-6 font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
          Palette set not loaded.
        </p>
      ) : (
        <div className="-mx-2 mt-5 overflow-x-auto pb-3 [scrollbar-width:thin]">
          <ul className="flex snap-x snap-mandatory gap-4 px-2">
            {palettes.map((p) => (
              <li key={p.id} className="snap-start shrink-0 basis-[240px] md:basis-[280px]">
                <PaletteSwatchCard palette={p} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PaletteSwatchCard({ palette: p }: { palette: DashboardPaletteCard }) {
  // Background tint pulled from the palette so each card has a subtle
  // hint of the colour story even before you focus on the swatches.
  const tintCss = `linear-gradient(135deg, ${p.swatchHexes[0] ?? '#F4EFE6'}1A 0%, ${p.swatchHexes[2] ?? '#C4956A'}10 100%)`;
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border transition hover:border-editorial-borderStrong"
      style={{ background: tintCss }}
    >
      {/* Big swatch strip = the visual anchor. Each colour gets equal
          space so the palette's tonal range is readable at a glance. */}
      <div className="grid h-32 grid-cols-5">
        {p.swatchHexes.slice(0, 5).map((hex, i) => (
          <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          T {p.timelessness}/10 · {p.personaFit.slice(0, 2).join(' · ')}
        </p>
        <p className="font-serif text-[18px] leading-tight text-editorial-ink">{p.name}</p>
        <p className="line-clamp-2 font-dmsans text-[12px] leading-relaxed text-editorial-taupe">
          {p.vibe}
        </p>
        <p className="mt-auto line-clamp-1 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          {p.trendSource}
        </p>
        {/* Shop is primary (products-first); start a project is the
            secondary path. Reflects the dashboard's product-led IA. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/catalogue?palette=${p.id}`}
            className="rounded-full bg-editorial-ink px-3 py-1.5 font-dmsans text-[11px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            ✦ Shop this palette
          </Link>
          <Link
            href={`/projects/new?palette=${p.id}`}
            className="rounded-full border border-editorial-borderStrong px-3 py-1.5 font-dmsans text-[11px] font-medium text-editorial-ink transition hover:bg-editorial-cream"
          >
            Start a project
          </Link>
        </div>
      </div>
    </article>
  );
}

function TrendsCarousel({
  anchor,
  title,
  intro,
  cards,
  emptyCopy,
}: {
  anchor: string;
  title: string;
  intro: string;
  cards: DashboardTrendCard[];
  emptyCopy: string;
}) {
  return (
    <section id={anchor} className="mb-12 last:mb-0">
      <SectionHeader
        title={title}
        action={{ label: 'See all →', href: `/dashboard#${anchor}` }}
      />
      <p className="mt-2 max-w-3xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
        {intro}
      </p>

      {cards.length === 0 ? (
        <p className="mt-6 font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
          {emptyCopy}
        </p>
      ) : (
        // Horizontal snap-scroll. Cards keep a fixed width so multiple
        // are partially visible — the half-clipped trailing card is the
        // affordance that says "there's more to the right". -mx + px on
        // the inner padding lets the first card sit flush against the
        // container edge without breaking out of the layout grid.
        <div className="-mx-2 mt-5 overflow-x-auto pb-3 [scrollbar-width:thin]">
          <ul className="flex snap-x snap-mandatory gap-4 px-2">
            {cards.map((t) => (
              <li key={t.id} className="snap-start shrink-0 basis-[280px] md:basis-[320px]">
                <TrendCardArticle card={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TrendCardArticle({ card: t }: { card: DashboardTrendCard }) {
  const tintCss = `linear-gradient(135deg, ${t.paletteHexes[0] ?? '#F4EFE6'}1A 0%, ${t.paletteHexes[2] ?? '#C4956A'}10 100%)`;
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border transition hover:border-editorial-borderStrong"
      style={{ background: tintCss }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-editorial-cream">
        <Image
          src={t.imageUrl}
          alt={t.headline}
          fill
          sizes="320px"
          className="object-cover"
          unoptimized
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
            {t.season} · {t.roomType.replace(/_/g, ' ')}
          </p>
          <p className="mt-2 line-clamp-2 font-serif text-[18px] leading-tight text-editorial-ink">
            {t.headline}
          </p>
          <PaletteStrip colors={t.paletteHexes.slice(0, 5)} className="mt-3" />
          {t.matchNote ? (
            <p className="mt-2 font-dmsans text-[11px] italic text-editorial-cognac">
              {t.matchNote}
            </p>
          ) : null}
        </div>
        <p className="line-clamp-3 font-dmsans text-[12px] leading-relaxed text-editorial-taupe">
          {t.description}
        </p>
        {/* Shop this trend is the primary CTA — products-first IA. The
            render-with-this-trend path becomes secondary. */}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link
            href={`/catalogue?palette=${t.paletteId}&room=${t.roomType}`}
            className="flex-1 rounded-full bg-editorial-ink px-3 py-2 text-center font-dmsans text-[11px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            ✦ Shop this trend
          </Link>
          <Link
            href={`/projects/new?palette=${t.paletteId}&room=${t.roomType}`}
            className="rounded-full border border-editorial-borderStrong px-3 py-2 font-dmsans text-[11px] font-medium text-editorial-ink transition hover:bg-editorial-cream"
          >
            Render it
          </Link>
        </div>
      </div>
    </article>
  );
}
