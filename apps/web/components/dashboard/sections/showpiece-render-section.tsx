'use client';

// Showpiece render strip — the dashboard's hero visual.
//
// Phase 1 shipped this as a static image + Shop CTA. Phase 3 (#136)
// layers interactive hotspot dots over each detected product. Each
// dot maps to a picking_list bbox in 0..1 percentage space (set
// at match time so we don't need original image dimensions on the
// client). Tapping a dot opens an inline product drawer below the
// image with the top-ranked match — name, retailer, price, image,
// "Shop at retailer" CTA, "Save to board" CTA.
//
// Mobile-first: the drawer expands inline (no floating popover —
// those get clipped on phones). Dots are ≥ 28px touch targets via
// an outer hit area, even though the visible dot is smaller.

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';
import { AddToProjectButton } from '@/components/projects/add-to-project-button';
import { cn } from '@/lib/utils';

export interface ShowpieceRender {
  id: string;
  imageUrl: string;
  prompt: string | null;
  paletteHexes: string[];
  itemCount: number;
  budgetAud: number | null;
  createdAt: string;
}

// Subset of PickingListItem used for the overlay. The full type lives
// in lib/matching.ts but we only need a slice here.
export interface ShowpieceHotspot {
  itemLabel: string;
  category: string;
  bbox: { x: number; y: number; w: number; h: number };
  match: {
    productId: string;
    name: string;
    retailer: string;
    priceAud: number | null;
    imageUrl: string;
    productUrl: string;
  } | null;
}

interface ShowpieceRenderSectionProps {
  render: ShowpieceRender | null;
  hotspots?: ShowpieceHotspot[];
  /** When the user has no renders, we fall back to a demo image so
   *  the section never reads empty. */
  demoImageUrl?: string;
}

export function ShowpieceRenderSection({
  render,
  hotspots = [],
  demoImageUrl,
}: ShowpieceRenderSectionProps) {
  if (!render) {
    if (!demoImageUrl) return null;
    return (
      <section id="showpiece" className="py-8 md:py-10">
        <SectionHeader title="See what's possible" />
        <Link
          href="/rooms/new"
          className="group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border border-editorial-border bg-editorial-cream md:aspect-[21/9]"
        >
          <Image
            src={demoImageUrl}
            alt="Sample render — restyled lounge room"
            fill
            sizes="(max-width: 768px) 100vw, 1100px"
            className="object-cover transition group-hover:scale-[1.01]"
            unoptimized
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-editorial-ink/70 via-editorial-ink/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 md:flex-row md:items-end md:justify-between md:p-7">
            <div>
              <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-cream/80">
                Sample render
              </p>
              <p className="mt-1 font-serif text-[22px] leading-tight text-editorial-cream md:text-[28px]">
                Your room, restyled with real AU products.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-editorial-cream px-4 py-2 font-dmsans text-[13px] font-medium text-editorial-ink transition group-hover:opacity-90 md:px-5 md:py-2.5">
              ◎ Try it with your room →
            </span>
          </div>
        </Link>
      </section>
    );
  }

  return <LiveShowpiece render={render} hotspots={hotspots} />;
}

function LiveShowpiece({
  render,
  hotspots,
}: {
  render: ShowpieceRender;
  hotspots: ShowpieceHotspot[];
}) {
  // Filter to hotspots that actually carry a match — un-matched bbox
  // entries (Claude detected a thing but no catalogue match) would
  // give a dot with no destination, which is worse than nothing.
  const visibleHotspots = hotspots.filter((h) => h.match);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active =
    activeIndex !== null && visibleHotspots[activeIndex] ? visibleHotspots[activeIndex] : null;

  return (
    <section id="showpiece" className="py-8 md:py-10">
      <SectionHeader
        title="Your latest render"
        action={{ label: 'See all renders →', href: '/projects' }}
      />
      <div className="overflow-hidden rounded-2xl border border-editorial-border bg-editorial-surface">
        {/* Image + hotspot overlay. The whole image is wrapped in a
            Link only when there are no hotspots; with hotspots we
            promote the dot interactions to primary and move the
            "view full render" CTA into the metadata band below. */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-editorial-cream md:aspect-[21/9]">
          <Image
            src={render.imageUrl}
            alt={render.prompt ?? 'Latest render'}
            fill
            sizes="(max-width: 768px) 100vw, 1100px"
            className="object-cover"
            unoptimized
            priority
          />
          {/* Hotspot dots — absolute-positioned at bbox centres.
              Touch target is the outer 28px button; the visible dot
              is the inner 12-14px pulse. */}
          {visibleHotspots.map((h, i) => {
            const cx = (h.bbox.x + h.bbox.w / 2) * 100;
            const cy = (h.bbox.y + h.bbox.h / 2) * 100;
            const isActive = activeIndex === i;
            return (
              <button
                key={`${h.itemLabel}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex(isActive ? null : i);
                }}
                aria-label={`View ${h.match?.name ?? h.itemLabel}`}
                aria-expanded={isActive}
                style={{ left: `${cx}%`, top: `${cy}%` }}
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2',
                  // Mobile gets 44x44 (Apple HIG minimum); desktop
                  // shrinks to 36x36 since hover targeting is more
                  // forgiving with a mouse.
                  'grid h-11 w-11 place-items-center rounded-full md:h-9 md:w-9',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-editorial-cream',
                )}
              >
                <span
                  className={cn(
                    // Visible dot scales with the touch target on
                    // mobile so it feels deliberate, not lost in the
                    // larger hit area.
                    'block h-4 w-4 rounded-full border-2 transition md:h-3.5 md:w-3.5',
                    isActive
                      ? 'border-editorial-ink bg-editorial-cream scale-125'
                      : 'border-editorial-cream bg-editorial-cognac/90 group-hover:scale-110 animate-pulse',
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Inline drawer — appears below the image when a dot is
            active. Smooth max-h transition keeps the layout calm. */}
        <div
          className={cn(
            'overflow-hidden border-b border-editorial-border transition-[max-height] duration-300 ease-out',
            active ? 'max-h-[360px]' : 'max-h-0',
          )}
        >
          {active && active.match ? (
            <HotspotDrawer hotspot={active} onClose={() => setActiveIndex(null)} />
          ) : null}
        </div>

        {/* Metadata band — palette strip + counts + Shop CTA. */}
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
            {render.paletteHexes.length > 0 ? (
              <div className="flex h-6 w-32 overflow-hidden rounded-full border border-editorial-border md:h-7 md:w-40">
                {render.paletteHexes.slice(0, 5).map((hex, i) => (
                  <div key={`${hex}-${i}`} className="flex-1" style={{ backgroundColor: hex }} />
                ))}
              </div>
            ) : null}
            <div className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe md:text-[11px]">
              <span className="text-editorial-ink">{render.itemCount}</span> matched items
              {visibleHotspots.length > 0 ? (
                <>
                  {' · '}
                  <span className="text-editorial-cognac">Tap any dot to shop</span>
                </>
              ) : null}
              {render.budgetAud != null ? (
                <>
                  {' · '}
                  <span className="text-editorial-ink">
                    ${Math.round(render.budgetAud).toLocaleString('en-AU')}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <Link
            href={`/renders/${render.id}#picking-list`}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-editorial-ink px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90 md:px-6 md:py-3 md:text-[14px]"
          >
            ✦ Shop this look
          </Link>
        </div>
      </div>
    </section>
  );
}

function HotspotDrawer({
  hotspot,
  onClose,
}: {
  hotspot: ShowpieceHotspot;
  onClose: () => void;
}) {
  if (!hotspot.match) return null;
  const m = hotspot.match;
  return (
    <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:p-6">
      <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-xl bg-editorial-cream md:h-36 md:w-36">
        <Image
          src={m.imageUrl}
          alt={m.name}
          fill
          sizes="160px"
          className="object-cover"
          unoptimized
        />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cognac">
              {hotspot.itemLabel} · {hotspot.category.replace(/_/g, ' ')}
            </p>
            <p className="mt-1 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
              {m.retailer}
            </p>
            <p className="mt-1 line-clamp-2 font-serif text-[16px] leading-tight text-editorial-ink md:text-[17px]">
              {m.name}
            </p>
            <p className="mt-1 font-serif text-[17px] text-editorial-ink md:text-[18px]">
              {m.priceAud != null
                ? `$${Math.round(m.priceAud).toLocaleString('en-AU')}`
                : 'POA'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="rounded-full p-1.5 text-editorial-taupe transition hover:bg-editorial-cream hover:text-editorial-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={m.productUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="rounded-full bg-editorial-ink px-4 py-2 font-dmsans text-[11px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            View at {m.retailer} ↗
          </Link>
          <AddToProjectButton productId={m.productId} variant="compact" />
          <AddToVisionBoardButton
            ref={{ itemType: 'product', productId: m.productId }}
            variant="compact"
          />
        </div>
      </div>
    </div>
  );
}
