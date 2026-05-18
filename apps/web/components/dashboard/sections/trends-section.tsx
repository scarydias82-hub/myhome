'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { PaletteStrip } from '@/components/dashboard/shared/palette-strip';
import { cn } from '@/lib/utils';

export interface DashboardTrendCard {
  id: string;
  headline: string;
  paletteName: string;
  paletteHexes: string[];
  roomType: string;
  season: string; // e.g. "2026 · Dulux"
  description: string;
  matchNote: string | null; // computed from user's boards
  imageUrl: string;
  paletteId: string;
}

interface TrendsSectionProps {
  trends: DashboardTrendCard[];
}

export function TrendsSection({ trends }: TrendsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(trends[0]?.id ?? null);

  return (
    <section id="trends" className="py-10">
      <SectionHeader
        title="Design trends for you"
        action={{ label: 'See all trends →', href: '/dashboard#trends' }}
      />

      <ul className="space-y-4">
        {trends.map((t) => {
          const isOpen = expandedId === t.id;
          const tintCss = `linear-gradient(135deg, ${t.paletteHexes[0] ?? '#F4EFE6'}1A 0%, ${t.paletteHexes[2] ?? '#C4956A'}10 100%)`;
          return (
            <li key={t.id}>
              <article
                className={cn(
                  'overflow-hidden rounded-2xl border transition',
                  isOpen ? 'border-editorial-borderStrong' : 'border-editorial-border',
                )}
                style={{ background: tintCss }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : t.id)}
                  aria-expanded={isOpen}
                  className="grid w-full grid-cols-[200px_1fr_auto] items-center gap-6 p-5 text-left md:grid-cols-[260px_1fr_auto]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-editorial-cream">
                    <Image
                      src={t.imageUrl}
                      alt={t.headline}
                      fill
                      sizes="260px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div>
                    <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
                      {t.season} · {t.roomType.replace(/_/g, ' ')}
                    </p>
                    <p className="mt-2 font-serif text-[22px] leading-tight text-editorial-ink">
                      {t.headline}
                    </p>
                    <PaletteStrip colors={t.paletteHexes.slice(0, 5)} className="mt-3" />
                    {t.matchNote ? (
                      <p className="mt-2 font-dmsans text-[12px] italic text-editorial-cognac">
                        {t.matchNote}
                      </p>
                    ) : null}
                  </div>
                  <span
                    aria-hidden
                    className={cn(
                      'font-dmmono text-[14px] text-editorial-cognac transition-transform',
                      isOpen ? 'rotate-90' : 'rotate-0',
                    )}
                  >
                    ›
                  </span>
                </button>
                {isOpen ? (
                  <div className="border-t border-editorial-border bg-editorial-surface/60 p-5">
                    <p className="max-w-2xl font-dmsans text-[14px] leading-relaxed text-editorial-ink">
                      {t.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href={`/projects/new?palette=${t.paletteId}&room=${t.roomType}`}
                        className="rounded-full bg-editorial-ink px-4 py-2 font-dmsans text-[12px] font-medium text-editorial-cream transition hover:opacity-90"
                      >
                        ✦ Generate room with this palette
                      </Link>
                      <Link
                        href={`/catalogue?palette=${t.paletteId}`}
                        className="rounded-full border border-editorial-borderStrong px-4 py-2 font-dmsans text-[12px] font-medium text-editorial-ink transition hover:bg-editorial-cream"
                      >
                        Shop matching products
                      </Link>
                    </div>
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
