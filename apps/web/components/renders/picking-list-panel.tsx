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
  // Physical W × D × H. Any axis may be null if the scraper couldn't
  // extract it. Surfaced on the match card so the user can verify fit
  // without clicking through to the retailer.
  dimensions?: {
    width_cm?: number | null;
    depth_cm?: number | null;
    height_cm?: number | null;
  } | null;
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
  /** Server-seeded set of product IDs the current user has already
   *  saved to their wishlist (P1-7). Match cards initialise their
   *  saved state from this; toggling fires /api/wishlist and updates
   *  local state optimistically. Omit / pass empty Set to render every
   *  card in the unsaved state — the heart still works, it just won't
   *  show pre-saved items as saved until the user toggles. */
  initialSavedProductIds?: Set<string>;
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

// Format whatever subset of W × D × H we have. Returns null if no axis
// is set so the caller can skip rendering the line entirely.
function formatDimensions(
  d: PickingMatch['dimensions'] | null | undefined,
): string | null {
  if (!d) return null;
  const w = d.width_cm != null ? `W ${Math.round(d.width_cm)}` : null;
  const dp = d.depth_cm != null ? `D ${Math.round(d.depth_cm)}` : null;
  const h = d.height_cm != null ? `H ${Math.round(d.height_cm)}` : null;
  const parts = [w, dp, h].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return `${parts.join(' × ')} cm`;
}

export function PickingListPanel({
  items,
  activeIndex,
  onHover,
  renderId,
  projectId,
  initialSavedProductIds,
}: PickingListPanelProps) {
  const router = useRouter();
  const [staging, setStaging] = useState<StagingTarget | null>(null);
  const [multiOpen, setMultiOpen] = useState(false);
  const [multi, setMulti] = useState<MultiSelection[]>([]);
  // Per-user wishlist (#106). We seed from the server-side fetch and
  // mutate optimistically — POST /api/wishlist persists. Rollback on
  // error keeps the local set honest.
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(initialSavedProductIds ?? []),
  );

  async function toggleSaved(productId: string) {
    const isSaved = savedIds.has(productId);
    // Optimistic: flip locally first, then sync.
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(productId);
      else next.add(productId);
      return next;
    });
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, action: isSaved ? 'remove' : 'save' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Roll back on failure so the UI doesn't drift from the server.
      console.error('[wishlist] toggle failed', err);
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(productId);
        else next.delete(productId);
        return next;
      });
    }
  }

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
                isSaved={(productId) => savedIds.has(productId)}
                onToggleSaved={(productId) => toggleSaved(productId)}
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
  isSaved,
  onToggleSaved,
}: {
  item: PickingListItem;
  index: number;
  onStage: (match: PickingMatch) => void;
  isSelectedFor: (productId: string) => boolean;
  onToggleMulti: (match: PickingMatch) => void;
  multiSlotTaken: (productId: string) => boolean;
  multiAtCap: boolean;
  isSaved: (productId: string) => boolean;
  onToggleSaved: (productId: string) => void;
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
            saved={isSaved(m.productId)}
            onToggleSaved={() => onToggleSaved(m.productId)}
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
  saved,
  onToggleSaved,
}: {
  match: PickingMatch;
  primary: boolean;
  onStage: () => void;
  selectedForMulti: boolean;
  disabledForMulti: boolean;
  onToggleMulti: () => void;
  saved: boolean;
  onToggleSaved: () => void;
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
            {formatDimensions(match.dimensions) ? (
              <p className="mt-0.5 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                {formatDimensions(match.dimensions)}
              </p>
            ) : null}
          </div>
          <p className="mt-1 font-display text-h4 text-ink">
            {match.priceAud != null ? aud.format(match.priceAud) : 'POA'}
          </p>
        </div>
      </div>
      {/* Two-primary-CTA layout (P1-7). Heart-icon Save banks the
          product to a per-user wishlist independent of any project;
          Stage is the room-specific staging modal. Compare lives as a
          quieter icon-toggle on the right so multi-stage isn't a
          competing primary action. View moves to a small text link
          below — still discoverable but doesn't pull the eye away
          from the two main verbs. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.06] pt-3">
        <button
          type="button"
          onClick={onToggleSaved}
          aria-pressed={saved}
          aria-label={saved ? `Saved · ${match.name}` : `Save ${match.name} to your wishlist`}
          className={cn(
            'grid h-9 w-9 place-items-center rounded-full border transition',
            saved
              ? 'border-clay/50 bg-clay/15 text-clay'
              : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-clay',
          )}
        >
          <HeartIcon filled={saved} />
        </button>
        <button
          type="button"
          onClick={onStage}
          className="flex-1 rounded-pill bg-ink px-4 py-2 text-center font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:bg-ink-soft"
        >
          Stage in my room
        </button>
        <label
          aria-label={selectedForMulti ? 'Remove from compare set' : 'Add to compare set'}
          className={cn(
            'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border font-mono text-[14px] transition',
            selectedForMulti
              ? 'border-olive/60 bg-olive/15 text-olive'
              : disabledForMulti
                ? 'cursor-not-allowed border-ink/10 bg-cream/50 text-ink-faint'
                : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
          )}
        >
          <input
            type="checkbox"
            checked={selectedForMulti}
            disabled={disabledForMulti}
            onChange={onToggleMulti}
            className="sr-only"
          />
          {selectedForMulti ? '✓' : '+'}
        </label>
      </div>
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="mt-2 font-mono text-meta uppercase tracking-eyebrow text-ink-faint underline-offset-2 hover:text-clay hover:underline"
      >
        View on {match.retailer} ↗
      </a>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
