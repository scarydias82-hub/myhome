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
// Bucket logic: timelessness >= 9 → Timeless directions. < 9 → 2026.
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
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';
import { PaletteSwatchCard } from '@/components/palettes/palette-swatch-card';

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
  /** Tag list from palettes.json — used for filter chips on /palettes. */
  tags: string[];
  /** Aggregate like count across all users (from palette_likes table).
   *  0 on cold-start. */
  likeCount: number;
  /** Whether the current user has liked this palette. */
  likedByUser: boolean;
}

interface TrendsSectionProps {
  trends: DashboardTrendCard[];
  /** Pure palette swatches — the 16 palettes shown as colour cards
   *  rather than rendered-in-room visuals. Mirrors the wizard's
   *  Step 3 "① Colour palette" carousel so the dashboard has a way
   *  to browse colour directly. */
  palettes: DashboardPaletteCard[];
}

const TIMELESS_THRESHOLD = 9;

export function TrendsSection({ trends, palettes }: TrendsSectionProps) {
  const trendForward = trends.filter((t) => (t.timelessness ?? 5) < TIMELESS_THRESHOLD);
  const timeless = trends.filter((t) => (t.timelessness ?? 5) >= TIMELESS_THRESHOLD);
  // The palette carousel receives a pre-composed, pre-sorted list from
  // the server (popular-by-aggregate-likes + this user's liked palettes,
  // lightest → darkest). No client-side filtering needed here.

  return (
    <section id="trends" className="py-10">
      {/* ① Colour palette carousel — community-popular + your liked
          palettes, ordered lightest → darkest. Full 56-palette catalogue
          at /palettes. */}
      <PaletteCarousel
        anchor="palettes"
        title="Colour palettes"
        intro="What the community loves, plus your liked palettes — lightest to darkest. Like a card to keep it here. Browse all 56 palettes for the full range."
        palettes={palettes}
        seeAllHref="/palettes"
      />

      {/* ② 2026 Design Trends carousel — what's hot this year, sourced
          from WGSN, Pantone, Benjamin Moore, Sherwin-Williams, Dulux AU
          et al. Dedup-by-palette upstream means each trend-forward
          palette (timelessness < 9) gets exactly one card here. */}
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
  seeAllHref,
}: {
  anchor: string;
  title: string;
  intro: string;
  palettes: DashboardPaletteCard[];
  /** Where the "See all →" header CTA points. Defaults to anchor jump
   *  for the legacy in-page carousels; the popular palette carousel
   *  passes /palettes to deep-link into the full catalogue. */
  seeAllHref?: string;
}) {
  return (
    <section id={anchor} className="mb-12">
      <SectionHeader
        title={title}
        action={{ label: 'See all →', href: seeAllHref ?? `/dashboard#${anchor}` }}
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
            render-with-this-trend path becomes secondary. Save-to-
            board is the lowest-commitment third option. */}
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
          <AddToVisionBoardButton
            itemRef={{ itemType: 'trend', trendCardId: t.id }}
            variant="compact"
          />
        </div>
      </div>
    </article>
  );
}
