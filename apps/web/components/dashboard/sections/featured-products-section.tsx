'use client';

// Featured products carousel — sits high on the dashboard so users
// see *products* (the destination) before they see trends or projects
// (the funnel). Each card carries a provenance hook ("Featured in N
// renders", "Editor's pick this week") so the user understands WHY
// this product is in front of them.
//
// Phase 1 ships with a heuristic curation:
//   1. Products with the highest count of shortlist_items references
//      (proxy: "saved by users this week") — surfaced with the
//      "saved by N this week" hook
//   2. Fallback: most recent products with high-quality images
//
// Phase 4 will replace the heuristic with a weekly Claude-curated
// set (#137). The component shape stays the same so the swap is a
// data-source change, not a UI change.

import Image from 'next/image';
import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { Tag } from '@/components/dashboard/shared/tag';
import { AddToProjectButton } from '@/components/projects/add-to-project-button';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';

export interface FeaturedProductCard {
  id: string;
  name: string;
  retailer: string;
  category: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  /** Provenance hook — short editorial copy explaining why this
   *  product is featured this week. e.g. "Featured in 3 renders",
   *  "Editor's pick", "From a designer's brief". */
  hook: string;
  /** Optional styleTags surfaced as small chips. Capped at 2 in the
   *  card to keep the visual quiet. */
  styleTags: string[];
}

interface FeaturedProductsSectionProps {
  products: FeaturedProductCard[];
}

export function FeaturedProductsSection({ products }: FeaturedProductsSectionProps) {
  if (products.length === 0) return null;

  return (
    <section id="featured-products" className="py-8 md:py-10">
      <SectionHeader
        title="Featured this week"
        action={{ label: 'See all →', href: '/catalogue' }}
      />
      <p className="mb-4 max-w-2xl font-dmsans text-[12px] leading-relaxed text-editorial-taupe md:mb-5 md:text-[13px]">
        Curated picks from the AU catalogue — each one's been chosen for how it pairs with this
        season's palettes and how often it's landed in our community's saved boards.
      </p>

      {/* Snap-x horizontal scroll. -mx-4 + px-4 on the inner row lets
          the first card sit flush with the viewport edge on mobile so
          the affordance reads as "swipe me" rather than "I'm boxed
          in." pb-3 reserves space for the scroll-progress feel without
          clipping focus rings. */}
      <div className="-mx-4 overflow-x-auto pb-3 md:-mx-2 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-3 px-4 md:gap-4 md:px-2">
          {products.map((p) => (
            <li
              key={p.id}
              // Mobile: ~85vw so one card dominates the screen, with
              // a sliver of the next card peeking — the "more right"
              // affordance. md+ keeps fixed widths for desktop scan.
              className="snap-start shrink-0 basis-[85vw] sm:basis-[60vw] md:basis-[300px]"
            >
              <FeaturedCard product={p} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeaturedCard({ product: p }: { product: FeaturedProductCard }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border bg-editorial-surface transition hover:border-editorial-borderStrong">
      {/* Image link → retailer. Tap target is the whole image. */}
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
          sizes="(max-width: 768px) 70vw, 300px"
          className="object-cover"
          unoptimized
        />
        {/* Provenance ribbon — sits over the image so it's the first
            thing the user reads, even before the name. Cognac accent
            keeps it editorial. */}
        <span className="absolute left-3 top-3 rounded-full bg-editorial-ink/85 px-3 py-1 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cream backdrop-blur">
          {p.hook}
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
        {/* AddToProjectButton lives inside the card so the action is
            persistently visible (vs the AR section's expand-to-reveal
            pattern). Mobile users shouldn't need to tap twice to add
            something they want. */}
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
