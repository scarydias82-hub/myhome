'use client';

// Complete-the-look panel (#116) — sits below the detection-based
// hotspot picking list on the render result page. Categories the
// render's room type expects, filtered to the chosen palette + style.
//
// Reuses the MatchCard pattern from the existing picking list so
// every visible product surfaces dimensions + hex swatches + wishlist
// save in the same way. Heart icons are wired against the same
// /api/wishlist endpoint as the main picking list, sharing the
// initialSavedProductIds set passed in from the render page.

import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { AddToProjectButton } from '@/components/projects/add-to-project-button';
import type { PickingMatch } from '@/components/renders/picking-list-panel';

interface CompleteTheLookProps {
  categories: { displayLabel: string; products: PickingMatch[] }[];
  initialSavedProductIds?: Set<string>;
}

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

// Slug for the id="cat-{slug}" anchor on each carousel. ShoppableRender
// uses the same slugifier when a hotspot is clicked so the page can
// scroll to the matching carousel. Keep both call-sites in sync — the
// helper is exported.
export function slugifyCategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

export function CompleteTheLook({
  categories,
  initialSavedProductIds,
}: CompleteTheLookProps) {
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(initialSavedProductIds ?? []),
  );

  async function toggleSaved(productId: string) {
    const isSaved = savedIds.has(productId);
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
      console.error('[wishlist] toggle failed', err);
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(productId);
        else next.delete(productId);
        return next;
      });
    }
  }

  if (categories.length === 0) return null;

  return (
    <section className="mt-12 rounded-2xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 md:p-10">
      <Eyebrow>Shop by category</Eyebrow>
      <p className="mt-2 font-display text-h3 text-ink">
        Picks for every <em>category</em>, palette-matched.
      </p>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
        Curated go-to's across the categories this room calls for. Swipe each
        row — the heart saves to your wishlist for later.
      </p>

      <div className="mt-8 space-y-10">
        {categories.map((cat) => (
          <CategoryCarousel
            key={cat.displayLabel}
            label={cat.displayLabel}
            products={cat.products}
            savedIds={savedIds}
            onToggleSaved={toggleSaved}
          />
        ))}
      </div>
    </section>
  );
}

// Carousel-style horizontal scroll per category. Each card is a fixed
// width (~64-72 of viewport on mobile, ~280px on desktop) and the row
// scrolls horizontally with native momentum. Cards beyond the viewport
// are visible by swipe/scroll — no pagination dots, no nav arrows for
// v1 (those can land in Phase 3 alongside the extended-set expansion).
function CategoryCarousel({
  label,
  products,
  savedIds,
  onToggleSaved,
}: {
  label: string;
  products: PickingMatch[];
  savedIds: Set<string>;
  onToggleSaved: (productId: string) => void;
}) {
  if (products.length === 0) return null;
  return (
    <div id={`cat-${slugifyCategory(label)}`} className="scroll-mt-24">
      <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">{label}</p>
      <div className="relative mt-3 -mx-6 md:-mx-10">
        <ul
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-3 md:px-10 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          role="list"
        >
          {products.map((p) => (
            <li
              key={p.productId}
              className="w-[70vw] max-w-[280px] shrink-0 snap-start sm:w-[44vw] md:w-[280px]"
            >
              <CompactMatchCard
                match={p}
                saved={savedIds.has(p.productId)}
                onToggleSaved={() => onToggleSaved(p.productId)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CompactMatchCard({
  match,
  saved,
  onToggleSaved,
}: {
  match: PickingMatch;
  saved: boolean;
  onToggleSaved: () => void;
}) {
  const target = match.affiliateUrl ?? match.productUrl;
  const dim = formatDimensions(match.dimensions);
  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-ink/[0.06] bg-cream p-3 transition hover:border-ink/20">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-ink/[0.04]">
          {match.hex ? (
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
            <div className="absolute inset-0 flex items-center justify-center text-meta uppercase tracking-eyebrow text-ink-faint">
              No image
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <p className="line-clamp-2 font-display text-[14px] leading-tight text-ink">
              {match.name}
            </p>
            <p className="mt-0.5 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              {match.retailer}
            </p>
            {dim ? (
              <p className="mt-0.5 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                {dim}
              </p>
            ) : null}
          </div>
          <p className="mt-1 font-display text-h4 text-ink">
            {match.priceAud != null ? aud.format(match.priceAud) : 'POA'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.06] pt-2">
        <button
          type="button"
          onClick={onToggleSaved}
          aria-pressed={saved}
          aria-label={saved ? `Saved · ${match.name}` : `Save ${match.name} to your wishlist`}
          className={cn(
            'grid h-8 w-8 place-items-center rounded-full border transition',
            saved
              ? 'border-clay/50 bg-clay/15 text-clay'
              : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-clay',
          )}
        >
          <HeartIcon filled={saved} />
        </button>
        <AddToProjectButton productId={match.productId} variant="compact" />
        <a
          href={target}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ml-auto font-mono text-meta uppercase tracking-eyebrow text-ink-faint underline-offset-2 hover:text-clay hover:underline"
        >
          View on {match.retailer} ↗
        </a>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="14"
      height="14"
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
