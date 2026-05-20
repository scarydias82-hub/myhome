'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { Pill } from '@/components/saltbush/pill';
import { StagingModal } from '@/components/renders/staging-modal';
import { MultiStagingModal } from '@/components/renders/multi-staging-modal';

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
  // Paint products carry the swatch hex — we render a coloured tile
  // instead of an <Image> when this is set.
  hex?: string | null;
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
  renderId: string;
  projectId?: string | null;
}

interface StagingTarget {
  itemIndex: number;
  match: PickingMatch;
}

interface MultiSelection {
  itemIndex: number;
  productId: string;
  productName: string;
}

const MAX_MULTI = 4;

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function PickingListPanel({
  items,
  activeIndex,
  onHover,
  renderId,
  projectId,
}: PickingListPanelProps) {
  const router = useRouter();
  const [staging, setStaging] = useState<StagingTarget | null>(null);
  const [multiOpen, setMultiOpen] = useState(false);
  const [multi, setMulti] = useState<MultiSelection[]>([]);

  const multiKey = useMemo(
    () => (sel: MultiSelection) => `${sel.itemIndex}:${sel.productId}`,
    [],
  );
  const multiSelectedKeys = useMemo(
    () => new Set(multi.map(multiKey)),
    [multi, multiKey],
  );

  function toggleMulti(itemIndex: number, match: PickingMatch) {
    const key = `${itemIndex}:${match.productId}`;
    setMulti((prev) => {
      if (prev.some((p) => multiKey(p) === key)) {
        return prev.filter((p) => multiKey(p) !== key);
      }
      // Replace any earlier selection from the same itemIndex — one product
      // per detected slot, otherwise the multi-stage prompt gets confused.
      const withoutSameSlot = prev.filter((p) => p.itemIndex !== itemIndex);
      if (withoutSameSlot.length >= MAX_MULTI) return prev;
      return [...withoutSameSlot, { itemIndex, productId: match.productId, productName: match.name }];
    });
  }

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
    <>
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
              <PickingListEntry
                item={item}
                index={idx}
                onStage={(match) => setStaging({ itemIndex: idx, match })}
                isSelectedFor={(productId) =>
                  multiSelectedKeys.has(`${idx}:${productId}`)
                }
                onToggleMulti={(match) => toggleMulti(idx, match)}
                multiSlotTaken={(productId) =>
                  multi.some((p) => p.itemIndex === idx && p.productId !== productId)
                }
                multiAtCap={multi.length >= MAX_MULTI}
              />
            </li>
          ))}
        </ol>
      </div>
      {staging ? (
        <StagingModal
          open
          // Every modal close path also refreshes the server component
          // so the new revision (just inserted by /api/stage) becomes
          // the active "after" image and shows up in the revision strip
          // without a manual reload.
          onClose={() => {
            setStaging(null);
            router.refresh();
          }}
          renderId={renderId}
          itemIndex={staging.itemIndex}
          projectId={projectId ?? null}
          product={{
            productId: staging.match.productId,
            name: staging.match.name,
            retailer: staging.match.retailer,
            imageUrl: staging.match.imageUrl,
            productUrl: staging.match.productUrl,
            affiliateUrl: staging.match.affiliateUrl,
          }}
        />
      ) : null}

      {/* Sticky multi-stage bar — appears once the user has selected >=2 items
          to stage in a single Flux call. Saves N-1 fal credits versus staging
          each separately. */}
      {multi.length >= 1 ? (
        <div className="sticky bottom-4 z-30 mt-4 rounded-xl border border-ink/15 bg-cream/95 p-3 shadow-soft backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Stage as one render · saves fal credits
              </p>
              <p className="mt-1 line-clamp-1 text-[14px] text-ink">
                {multi.map((m) => m.productName).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMulti([])}
                className="rounded-pill border border-ink/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft hover:border-ink/30 hover:text-ink"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setMultiOpen(true)}
                disabled={multi.length < 2}
                className="rounded-pill bg-ink px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:opacity-90 disabled:opacity-40"
              >
                {multi.length < 2 ? `+ Pick another (${multi.length}/${MAX_MULTI})` : `Stage ${multi.length} together`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {multiOpen ? (
        <MultiStagingModal
          open
          onClose={() => {
            setMultiOpen(false);
            router.refresh();
          }}
          renderId={renderId}
          projectId={projectId ?? null}
          selections={multi}
          onSuccess={() => {
            setMulti([]);
            setMultiOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function PickingListEntry({
  item,
  index,
  onStage,
  isSelectedFor,
  onToggleMulti,
  multiSlotTaken,
  multiAtCap,
}: {
  item: PickingListItem;
  index: number;
  onStage: (match: PickingMatch) => void;
  isSelectedFor: (productId: string) => boolean;
  onToggleMulti: (match: PickingMatch) => void;
  multiSlotTaken: (productId: string) => boolean;
  multiAtCap: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Full-width layout (#99): show the top THREE matches by default so
  // the user has options visible without expanding. The collapsed
  // single-card view made sense in the old 380px right-rail; with the
  // panel now spanning the container width below the render, a 3-up
  // grid uses the new real-estate productively.
  const DEFAULT_VISIBLE = 3;
  const visible = expanded ? item.matches : item.matches.slice(0, DEFAULT_VISIBLE);
  const more = item.matches.length - DEFAULT_VISIBLE;

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
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((m) => (
          <MatchCard
            key={m.productId}
            match={m}
            primary={m === item.matches[0]}
            onStage={() => onStage(m)}
            selectedForMulti={isSelectedFor(m.productId)}
            disabledForMulti={!isSelectedFor(m.productId) && (multiSlotTaken(m.productId) || multiAtCap)}
            onToggleMulti={() => onToggleMulti(m)}
          />
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

function MatchCard({
  match,
  primary,
  onStage,
  selectedForMulti,
  disabledForMulti,
  onToggleMulti,
}: {
  match: PickingMatch;
  primary: boolean;
  onStage: () => void;
  selectedForMulti: boolean;
  disabledForMulti: boolean;
  onToggleMulti: () => void;
}) {
  const target = match.affiliateUrl ?? match.productUrl;
  return (
    <div
      className={cn(
        'group flex flex-col gap-3 rounded-lg border p-3 transition',
        primary
          ? 'border-clay/40 bg-cream'
          : 'border-ink/[0.06] bg-paper-warm bg-grain hover:border-ink/20',
      )}
    >
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-ink/[0.04]">
          {match.hex ? (
            // Paint swatch — Dulux rows often have no usable product
            // photo, but the swatch hex IS the product. Render a solid
            // tile with a faint ring so it reads as a sample chip, not
            // a missing-image placeholder.
            <div
              className="absolute inset-0 rounded ring-1 ring-inset ring-ink/10"
              style={{ backgroundColor: match.hex }}
              aria-label={`${match.name} colour swatch`}
            />
          ) : match.imageUrl ? (
            <Image
              src={match.imageUrl}
              alt={match.name}
              fill
              sizes="80px"
              className="object-cover transition group-hover:scale-105"
              unoptimized
            />
          ) : (
            // No image and no hex — keep the slot legible rather than
            // showing a broken-image icon.
            <div className="absolute inset-0 flex items-center justify-center text-meta uppercase tracking-eyebrow text-ink-faint">
              No image
            </div>
          )}
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
          <p className="mt-1 font-display text-h4 text-ink">
            {match.priceAud != null ? aud.format(match.priceAud) : 'POA'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.06] pt-3">
        <label
          className={cn(
            'inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
            selectedForMulti
              ? 'border-olive bg-olive/15 text-olive'
              : disabledForMulti
                ? 'border-ink/10 bg-cream/50 text-ink-faint cursor-not-allowed'
                : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink cursor-pointer',
          )}
        >
          <input
            type="checkbox"
            checked={selectedForMulti}
            disabled={disabledForMulti}
            onChange={onToggleMulti}
            className="sr-only"
          />
          {selectedForMulti ? '✓ Selected' : '+ Stage with…'}
        </label>
        <button
          type="button"
          onClick={onStage}
          className="flex-1 rounded-pill bg-ink px-3 py-1.5 text-center font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:bg-ink-soft"
        >
          Try alone
        </button>
        <a
          href={target}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="rounded-pill border border-ink/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink"
        >
          View ↗
        </a>
      </div>
    </div>
  );
}
