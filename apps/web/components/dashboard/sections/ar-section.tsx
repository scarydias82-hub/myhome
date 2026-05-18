'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { CompatBar } from '@/components/dashboard/shared/compat-bar';
import { Tag } from '@/components/dashboard/shared/tag';
import { cn } from '@/lib/utils';

export interface ARProductCard {
  id: string;
  name: string;
  retailer: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  affiliateUrl: string | null;
  compatibility: number; // 0..100
  styleTags: string[];
  category: string;
}

interface ARSectionProps {
  products: ARProductCard[];
}

export function ARSection({ products }: ARSectionProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  return (
    <section id="ar" className="py-10">
      <SectionHeader
        title="Visualise in your room"
        action={{ label: 'Browse full catalogue →', href: '/catalogue' }}
      />

      {/* Hero CTA strip */}
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-editorial-border bg-editorial-surface p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cognac">
            AR try-on
          </p>
          <p className="mt-2 font-serif text-[20px] leading-snug text-editorial-ink">
            Place real products in your real room.
          </p>
          <p className="mt-1 max-w-xl font-dmsans text-[13px] text-editorial-taupe">
            Compositing via Flux fill — pick a product, see it sitting in your photo at the
            right scale and lighting.
          </p>
        </div>
        <Link
          href="/rooms/new"
          className="self-start rounded-full bg-editorial-ink px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90"
        >
          ◎ Open camera
        </Link>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const isExpanded = expanded === p.id;
          const isAdded = added[p.id];
          const buyHref = p.affiliateUrl ?? p.productUrl;
          return (
            <li key={p.id}>
              <article
                className={cn(
                  'flex h-full flex-col overflow-hidden rounded-2xl border transition',
                  isExpanded
                    ? 'border-editorial-borderStrong bg-editorial-surface'
                    : 'border-editorial-border bg-editorial-surface hover:border-editorial-borderStrong',
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                  aria-expanded={isExpanded}
                  className="relative aspect-[4/3] w-full overflow-hidden bg-editorial-cream text-left"
                >
                  <Image
                    src={p.imageUrl}
                    alt={p.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition group-hover:scale-[1.01]"
                    unoptimized
                  />
                </button>
                <div className="flex flex-col gap-3 p-5">
                  <div>
                    <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
                      {p.retailer}
                    </p>
                    <p className="mt-1.5 font-serif text-[17px] leading-tight text-editorial-ink">
                      {p.name}
                    </p>
                    <p className="mt-1 font-serif text-[18px] text-editorial-ink">
                      {p.priceAud != null
                        ? `$${Math.round(p.priceAud).toLocaleString('en-AU')}`
                        : 'POA'}
                    </p>
                  </div>
                  <CompatBar value={p.compatibility} />
                  <div className="flex flex-wrap gap-1.5">
                    {p.styleTags.slice(0, 2).map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                    <Tag tone="taupe">{p.category}</Tag>
                  </div>
                  {isExpanded ? (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Link
                        href={buyHref}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="rounded-full bg-editorial-ink px-3.5 py-1.5 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cream transition hover:opacity-90"
                      >
                        ◎ AR view
                      </Link>
                      <button
                        type="button"
                        onClick={() => setAdded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                        aria-pressed={isAdded}
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 font-dmmono text-[10px] uppercase tracking-[0.12em] transition',
                          isAdded
                            ? 'border-editorial-sage bg-[#E9F0E5] text-editorial-sage'
                            : 'border-editorial-borderStrong bg-editorial-surface text-editorial-ink hover:bg-editorial-cream',
                        )}
                      >
                        {isAdded ? '✓ Added' : '+ Project'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
