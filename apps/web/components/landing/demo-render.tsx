'use client';

// Above-the-fold homepage demo. A real rendered room with 3 interactive
// hotspots so a visitor can experience the value proposition without
// signing up. Hover any number to see what we'd put there (category +
// product preview); click scrolls them into the signup CTA.
//
// Asset swap-out: replace /public/demo/after.jpg with a polished render
// and update DEMO_ITEMS below if the products in frame change. No DB
// or auth wiring — this is intentionally hard-coded so it loads fast
// and is bullet-proof against backend changes.

import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface DemoMatch {
  name: string;
  retailer: string;
  imageUrl?: string;
  hex?: string;
  price?: number;
}

interface DemoItem {
  label: string;
  category: string;
  // Percentages of the image — same coordinate system the real Hotspot uses
  bbox: { x: number; y: number; w: number; h: number };
  topMatch: DemoMatch;
}

// Three curated hotspots aligned to the demo render. Paint uses a hex
// swatch (same path as the real picking list); furniture cards reference
// representative AU retailer products by name.
const DEMO_ITEMS: DemoItem[] = [
  {
    label: 'wall paint',
    category: 'Paint',
    bbox: { x: 0.45, y: 0.08, w: 0.1, h: 0.06 },
    topMatch: {
      name: 'Raw Umber',
      retailer: 'Dulux',
      hex: '#A07F65',
    },
  },
  {
    label: 'bed',
    category: 'Beds',
    bbox: { x: 0.38, y: 0.55, w: 0.1, h: 0.06 },
    topMatch: {
      name: 'Aero Linen Bed — Oat',
      retailer: 'GlobeWest',
      price: 3290,
    },
  },
  {
    label: 'side table',
    category: 'Side Tables',
    bbox: { x: 0.18, y: 0.62, w: 0.08, h: 0.05 },
    topMatch: {
      name: 'Pippa Tri Bedside — Oak',
      retailer: 'GlobeWest',
      price: 690,
    },
  },
];

export function HomepageDemoRender() {
  return (
    <section className="border-b border-editorial-border bg-editorial-cream/60">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-16 md:py-20 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="order-1">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-editorial-border bg-editorial-cream shadow-[0_30px_60px_-30px_rgba(40,30,20,0.25)]">
            <Image
              src="/demo/after.jpg"
              alt="Restyled bedroom in warm grounded earth palette"
              fill
              sizes="(max-width: 1024px) 100vw, 700px"
              className="object-cover"
              priority
              unoptimized
            />
            {DEMO_ITEMS.map((item, idx) => (
              <DemoHotspot key={idx} item={item} index={idx} />
            ))}
          </div>
          <p className="mt-3 text-center font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
            Interactive · hover each number to see what we&rsquo;d put there
          </p>
        </div>

        <div className="order-2 max-w-md">
          <p className="font-dmmono text-[11px] uppercase tracking-[0.18em] text-editorial-cognac">
            See it in action
          </p>
          <h2 className="mt-3 font-serif text-[34px] leading-[1.1] tracking-[-0.01em] text-editorial-ink md:text-[40px]">
            A bedroom in the <em className="font-normal italic text-editorial-cognac">warm grounded earth</em> palette.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-editorial-taupe">
            Every numbered piece is a real product from an Australian retailer. Price, dimensions
            and a buy link — visible without leaving the page. This is your render in about a
            minute, from your own room photo.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-full bg-editorial-ink px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-cream transition hover:bg-editorial-ink/90"
            >
              Render my room
            </Link>
            <Link
              href="#how"
              className="rounded-full border border-editorial-border px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-ink transition hover:border-editorial-ink/40"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoHotspot({ item, index }: { item: DemoItem; index: number }) {
  const cx = (item.bbox.x + item.bbox.w / 2) * 100;
  const cy = (item.bbox.y + item.bbox.h / 2) * 100;
  const popoverBelow = cy < 50;
  const { topMatch } = item;
  const aud = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  });

  return (
    <div
      className="group/hotspot absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${cx}%`, top: `${cy}%` }}
    >
      <button
        type="button"
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full font-dmmono text-[12px] font-medium shadow-[0_6px_16px_-6px_rgba(40,30,20,0.45)] transition',
          'bg-editorial-cream/95 text-editorial-ink hover:scale-105 hover:bg-editorial-cognac hover:text-editorial-cream',
        )}
        aria-label={`${item.label} — preview`}
      >
        {index + 1}
      </button>
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 hidden w-60 -translate-x-1/2 rounded-lg border border-editorial-border bg-editorial-cream p-3 shadow-[0_18px_40px_-20px_rgba(40,30,20,0.45)] group-hover/hotspot:block',
          popoverBelow ? 'top-full mt-2' : 'bottom-full mb-2',
        )}
      >
        <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
          {index + 1} · {item.label}
        </p>
        <p className="mt-1 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-cognac">
          {item.category}
        </p>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-editorial-ink/[0.04]">
            {topMatch.hex ? (
              <div
                className="absolute inset-0 ring-1 ring-inset ring-editorial-ink/10"
                style={{ backgroundColor: topMatch.hex }}
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] leading-tight text-editorial-ink">
              {topMatch.name}
            </p>
            <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
              {topMatch.retailer}
              {topMatch.price ? ` · ${aud.format(topMatch.price)}` : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
