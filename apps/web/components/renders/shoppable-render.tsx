'use client';

import { useState } from 'react';
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

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {view === 'shop' ? (
            <div className="relative overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
              <div className="relative aspect-[4/3] w-full">
                <Image
                  src={afterUrl}
                  alt="Restyled render"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 65vw"
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
        <PickingListPanel
          items={items}
          activeIndex={activeIndex}
          onHover={handleHover}
          renderId={renderId}
        />
      </div>
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
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      style={{ left: `${cx}%`, top: `${cy}%` }}
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full',
        'font-mono text-[12px] font-medium shadow-soft transition',
        active
          ? 'scale-110 bg-clay text-paper ring-4 ring-clay/30'
          : 'bg-paper/90 text-ink hover:scale-105 hover:bg-clay hover:text-paper',
      )}
      aria-label={`${item.itemLabel} — view matches`}
    >
      {index + 1}
    </button>
  );
}
