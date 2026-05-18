'use client';

import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { Pill } from '@/components/saltbush/pill';

export interface PickingMatch {
  productId: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  affiliateUrl: string | null;
  similarity: number;
}

export interface PickingListItem {
  itemLabel: string;
  category: string;
  bbox: { x: number; y: number; w: number; h: number };
  matches: PickingMatch[];
}

interface PickingListPanelProps {
  items: PickingListItem[];
  activeIndex: number | null;
  onHover: (index: number | null) => void;
}

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function PickingListPanel({ items, activeIndex, onHover }: PickingListPanelProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 text-center">
        <Eyebrow>Shop this render</Eyebrow>
        <p className="mt-3 font-display text-h4 text-ink">No items detected yet</p>
        <p className="mt-2 text-[14px] text-ink-soft">
          We couldn't auto-detect shoppable items. Try another room photo with more visible
          furniture.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink/[0.06] bg-cream shadow-soft">
      <div className="border-b border-ink/[0.06] p-5">
        <Eyebrow>Shop this render</Eyebrow>
        <p className="mt-2 font-display text-h4 text-ink">
          {items.length} {items.length === 1 ? 'item' : 'items'} matched
        </p>
        <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          AU retailers · live links
        </p>
      </div>
      <ol className="divide-y divide-ink/[0.06]">
        {items.map((item, idx) => (
          <li
            key={`${item.itemLabel}-${idx}`}
            onMouseEnter={() => onHover(idx)}
            onMouseLeave={() => onHover(null)}
            id={`pl-item-${idx}`}
            className={cn(
              'transition',
              activeIndex === idx ? 'bg-paper-warm' : 'bg-transparent',
            )}
          >
            <PickingListEntry item={item} index={idx} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function PickingListEntry({ item, index }: { item: PickingListItem; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? item.matches : item.matches.slice(0, 1);
  const more = item.matches.length - 1;

  return (
    <div className="p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-clay font-mono text-meta text-paper">
          {index + 1}
        </span>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {item.itemLabel}
        </p>
        <Pill tone="cream" size="sm">{item.category}</Pill>
      </div>
      <div className="mt-4 space-y-3">
        {visible.map((m) => (
          <MatchCard key={m.productId} match={m} primary={m === item.matches[0]} />
        ))}
      </div>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
        >
          {expanded ? '− Hide alternatives' : `+ ${more} similar`}
        </button>
      ) : null}
    </div>
  );
}

function MatchCard({ match, primary }: { match: PickingMatch; primary: boolean }) {
  const target = match.affiliateUrl ?? match.productUrl;
  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className={cn(
        'group flex gap-3 rounded-lg border p-3 transition',
        primary
          ? 'border-clay/40 bg-cream'
          : 'border-ink/[0.06] bg-paper-warm bg-grain hover:border-ink/20',
      )}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-ink/[0.04]">
        <Image
          src={match.imageUrl}
          alt={match.name}
          fill
          sizes="80px"
          className="object-cover transition group-hover:scale-105"
          unoptimized
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <p className="line-clamp-2 font-display text-[15px] leading-tight text-ink">
            {match.name}
          </p>
          <p className="mt-0.5 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {match.retailer}
          </p>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="font-display text-h4 text-ink">
            {match.priceAud != null ? aud.format(match.priceAud) : 'POA'}
          </p>
          <span className="font-mono text-meta uppercase tracking-eyebrow text-clay group-hover:underline">
            View ↗
          </span>
        </div>
      </div>
    </a>
  );
}
