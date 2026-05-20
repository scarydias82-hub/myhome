'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { BeforeAfterSlider } from '@/components/renders/before-after-slider';
import { PickingListPanel, type PickingListItem } from '@/components/renders/picking-list-panel';

interface ShoppableRenderProps {
  beforeUrl: string;
  afterUrl: string;
  items: PickingListItem[];
  totalEstimateAud: number | null;
  renderId: string;
  projectId?: string | null;
  /** Optional slot rendered between the image and the picking list.
   *  Used by the render page to drop the designer read in directly
   *  under the render so the voice frames the look before the user
   *  starts shopping. */
  between?: ReactNode;
  /** Server-seeded wishlist (#106). Threaded straight through to the
   *  picking-list panel so heart icons render in their saved state
   *  on first paint. */
  initialSavedProductIds?: Set<string>;
}

type View = 'shop' | 'compare';

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function ShoppableRender({
  beforeUrl,
  afterUrl,
  items,
  totalEstimateAud,
  renderId,
  projectId,
  between,
  initialSavedProductIds,
}: ShoppableRenderProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [view, setView] = useState<View>('shop');

  function handleHover(index: number | null) {
    setActiveIndex(index);
  }

  function handleHotspotClick(index: number) {
    setActiveIndex(index);
    document
      .getElementById(`pl-item-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-ink/[0.06] bg-cream p-1 font-mono text-meta uppercase tracking-eyebrow">
          <button
            type="button"
            onClick={() => setView('shop')}
            className={cn(
              'rounded-full px-4 py-2 transition',
              view === 'shop' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink',
            )}
          >
            Shop the look
          </button>
          <button
            type="button"
            onClick={() => setView('compare')}
            className={cn(
              'rounded-full px-4 py-2 transition',
              view === 'compare' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink',
            )}
          >
            Before / after
          </button>
        </div>
        {totalEstimateAud != null ? (
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Style this room from{' '}
            <span className="font-display text-h4 normal-case text-ink">
              {aud.format(totalEstimateAud)}
            </span>
          </p>
        ) : null}
      </div>

      {/* Render image centered + capped so the 4:3 aspect doesn't blow
          past the viewport, then the picking list takes the full
          container width below. Previous layout pinned the picking list
          in a 380px right rail which left a lot of empty real-estate
          under the image on wide screens. */}
      <div className="mx-auto w-full max-w-5xl">
        {view === 'shop' ? (
          <div className="relative overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
            <div className="relative aspect-[4/3] w-full">
              <Image
                src={afterUrl}
                alt="Restyled render"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 1024px"
                unoptimized
                priority
              />
              {items.map((item, idx) => (
                <Hotspot
                  key={idx}
                  item={item}
                  index={idx}
                  active={activeIndex === idx}
                  onHover={handleHover}
                  onClick={() => handleHotspotClick(idx)}
                />
              ))}
            </div>
          </div>
        ) : (
          <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={afterUrl} />
        )}
        <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Some links earn us a commission at no extra cost to you.
        </p>
      </div>

      {/* `between` slot — host page drops the designer read here so the
          voice frames the look before the shopping decisions begin. */}
      {between ?? null}

      <PickingListPanel
        items={items}
        activeIndex={activeIndex}
        onHover={handleHover}
        renderId={renderId}
        projectId={projectId ?? null}
        initialSavedProductIds={initialSavedProductIds}
      />
    </div>
  );
}

function Hotspot({
  item,
  index,
  active,
  onHover,
  onClick,
}: {
  item: PickingListItem;
  index: number;
  active: boolean;
  onHover: (i: number | null) => void;
  onClick: () => void;
}) {
  const cx = (item.bbox.x + item.bbox.w / 2) * 100;
  const cy = (item.bbox.y + item.bbox.h / 2) * 100;
  // Popover flips above the badge when the hotspot is in the lower half
  // of the image so it doesn't drop off-frame; flips below when up high.
  const popoverBelow = cy < 50;
  const topMatch = item.matches[0];
  return (
    <div
      className="group/hotspot absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${cx}%`, top: `${cy}%` }}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full font-mono text-[12px] font-medium shadow-soft transition',
          active
            ? 'scale-110 bg-clay text-paper ring-4 ring-clay/30'
            : 'bg-paper/90 text-ink hover:scale-105 hover:bg-clay hover:text-paper',
        )}
        aria-label={`${item.itemLabel} — view matches`}
      >
        {index + 1}
      </button>
      {/* Hover popover — shows the category label + the top matched
          product so the user can preview WHAT a hotspot represents
          without scrolling to the picking list below. Pointer-events
          none means it never blocks clicks on the badge. */}
      {topMatch ? (
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 z-20 hidden w-56 -translate-x-1/2 rounded-lg border border-ink/[0.08] bg-paper p-3 shadow-soft group-hover/hotspot:block',
            popoverBelow ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {index + 1} · {item.itemLabel}
          </p>
          <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-clay">
            {item.category}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-ink/[0.04]">
              {topMatch.hex ? (
                <div
                  className="absolute inset-0 ring-1 ring-inset ring-ink/10"
                  style={{ backgroundColor: topMatch.hex }}
                />
              ) : topMatch.imageUrl ? (
                <Image
                  src={topMatch.imageUrl}
                  alt={topMatch.name}
                  fill
                  sizes="40px"
                  className="object-cover"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-tight text-ink">
                {topMatch.name}
              </p>
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                {topMatch.retailer}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
