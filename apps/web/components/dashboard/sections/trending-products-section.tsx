'use client';

// Trending products carousel — ranks products by save-velocity over
// the trailing 7 days (count of shortlist_items inserts where
// kind='product'). This is the closest proxy to "users want this"
// we have without click-stream telemetry; in practice the signal is
// strong because adding a product to a project is a deliberate act.
//
// Each card carries the velocity hook ("+12 this week") so the user
// understands the social proof. If the 7-day count is zero (cold-
// start, first week) we fall back to lifetime adds.

import Image from 'next/image';
import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { Tag } from '@/components/dashboard/shared/tag';
import { AddToProjectButton } from '@/components/projects/add-to-project-button';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';

export interface TrendingProductCard {
  id: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  /** Save count in the trailing 7 days. Surfaced as "+N this week". */
  saves7d: number;
  /** Optional: lifetime save count, used as a tie-breaker hook when
   *  saves7d is zero. */
  savesLifetime: number;
  styleTags: string[];
}

interface TrendingProductsSectionProps {
  products: TrendingProductCard[];
}

export function TrendingProductsSection({ products }: TrendingProductsSectionProps) {
  if (products.length === 0) return null;

  return (
    <section id="trending-products" className="py-8 md:py-10">
      <SectionHeader
        title="Trending this week"
        action={{ label: 'See all →', href: '/catalogue?sort=trending' }}
      />
      <p className="mb-4 max-w-2xl font-dmsans text-[12px] leading-relaxed text-editorial-taupe md:mb-5 md:text-[13px]">
        The products our community has been saving most. Ordered by 7-day adds — a strong signal
        of what's resonating right now.
      </p>

      <div className="-mx-4 overflow-x-auto pb-3 md:-mx-2 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-3 px-4 md:gap-4 md:px-2">
          {products.map((p) => (
            <li
              key={p.id}
              // Mobile: 75vw so two cards are half-visible at once,
              // matching the "trending" feel of a feed scroll. md+
              // reverts to fixed widths.
              className="snap-start shrink-0 basis-[75vw] sm:basis-[50vw] md:basis-[280px]"
            >
              <TrendingCard product={p} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TrendingCard({ product: p }: { product: TrendingProductCard }) {
  // Hook copy — "+12 this week" if we have weekly data, else
  // "1.4k saved" if lifetime is high, else a neutral "Trending"
  // (still earns its place by being in the top of the list).
  const hook =
    p.saves7d > 0
      ? `+${p.saves7d} this week`
      : p.savesLifetime > 100
        ? `${p.savesLifetime.toLocaleString('en-AU')} saved`
        : 'Trending';

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border bg-editorial-surface transition hover:border-editorial-borderStrong">
      <Link
        href={p.productUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="relative block aspect-square w-full bg-editorial-cream"
        aria-label={`View ${p.name} at ${p.retailer}`}
      >
        <Image
          src={p.imageUrl}
          alt={p.name}
          fill
          sizes="(max-width: 768px) 60vw, 280px"
          className="object-cover"
          unoptimized
        />
        {/* Sage/green-ish accent — visually distinct from Featured
            (which uses ink/cream) so the two carousels read as
            different things at a glance. */}
        <span className="absolute left-3 top-3 rounded-full bg-editorial-sage/90 px-3 py-1 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cream backdrop-blur">
          ↑ {hook}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          {p.retailer}
        </p>
        <p className="line-clamp-2 font-serif text-[15px] leading-tight text-editorial-ink md:text-[16px]">
          {p.name}
        </p>
        <p className="font-serif text-[17px] text-editorial-ink md:text-[18px]">
          {p.priceAud != null
            ? `$${Math.round(p.priceAud).toLocaleString('en-AU')}`
            : 'POA'}
        </p>
        {p.styleTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {p.styleTags.slice(0, 2).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            <Tag tone="taupe">{p.category}</Tag>
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <AddToProjectButton productId={p.id} variant="compact" />
          <AddToVisionBoardButton
            ref={{ itemType: 'product', productId: p.id }}
            variant="compact"
          />
        </div>
      </div>
    </article>
  );
}
