'use client';

// Showpiece render strip — the dashboard's hero visual. Shows the
// user's most recent successful render at full-bleed width with
// overlay metadata, positioned to make the product placements
// inside the image feel aspirational and shoppable.
//
// Phase 3 (#136) layers interactive hotspot dots over each detected
// product — tap a dot → product detail modal. Phase 1 ships the
// static image + the "Shop this look" CTA which deep-links to the
// render's picking list.
//
// Empty state: when the user has zero renders yet, the strip becomes
// a "show off what's possible" surface with a sample render and a
// "Try it with your room" CTA → /rooms/new. We never hide this
// section — it's the most-engaging visual we have.

import Image from 'next/image';
import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';

export interface ShowpieceRender {
  id: string;
  imageUrl: string;
  prompt: string | null;
  paletteHexes: string[];
  itemCount: number;
  budgetAud: number | null;
  createdAt: string;
}

interface ShowpieceRenderSectionProps {
  render: ShowpieceRender | null;
  /** When the user has no renders, we fall back to a demo image so
   *  the section never reads empty. The demo URL is sourced from
   *  the homepage hero or a curated public bucket. */
  demoImageUrl?: string;
}

export function ShowpieceRenderSection({ render, demoImageUrl }: ShowpieceRenderSectionProps) {
  // Empty-state: surface the platform as aspirational rather than
  // "you haven't done anything yet."
  if (!render) {
    if (!demoImageUrl) return null;
    return (
      <section id="showpiece" className="py-8 md:py-10">
        <SectionHeader title="See what's possible" />
        <Link
          href="/rooms/new"
          className="group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border border-editorial-border bg-editorial-cream md:aspect-[21/9]"
        >
          <Image
            src={demoImageUrl}
            alt="Sample render — restyled lounge room"
            fill
            sizes="(max-width: 768px) 100vw, 1100px"
            className="object-cover transition group-hover:scale-[1.01]"
            unoptimized
            priority
          />
          {/* Gradient overlay so the CTA pop bottom-left is legible on
              any image. */}
          <div className="absolute inset-0 bg-gradient-to-t from-editorial-ink/70 via-editorial-ink/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 md:flex-row md:items-end md:justify-between md:p-7">
            <div>
              <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-cream/80">
                Sample render
              </p>
              <p className="mt-1 font-serif text-[22px] leading-tight text-editorial-cream md:text-[28px]">
                Your room, restyled with real AU products.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-editorial-cream px-4 py-2 font-dmsans text-[13px] font-medium text-editorial-ink transition group-hover:opacity-90 md:px-5 md:py-2.5">
              ◎ Try it with your room →
            </span>
          </div>
        </Link>
      </section>
    );
  }

  // Live render — showpiece treatment with palette strip + metadata
  // band + Shop CTA. Image takes full width to maximise visual
  // impact (this is the most aspirational asset on the dashboard).
  return (
    <section id="showpiece" className="py-8 md:py-10">
      <SectionHeader
        title="Your latest render"
        action={{ label: 'See all renders →', href: '/projects' }}
      />
      <div className="overflow-hidden rounded-2xl border border-editorial-border bg-editorial-surface">
        <Link
          href={`/renders/${render.id}`}
          className="group relative block aspect-[16/10] w-full overflow-hidden bg-editorial-cream md:aspect-[21/9]"
        >
          <Image
            src={render.imageUrl}
            alt={render.prompt ?? 'Latest render'}
            fill
            sizes="(max-width: 768px) 100vw, 1100px"
            className="object-cover transition group-hover:scale-[1.005]"
            unoptimized
            priority
          />
          {/* Bottom gradient — keeps the metadata band readable on any
              image without obscuring the product placements above. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-editorial-ink/55 to-transparent" />
        </Link>

        {/* Metadata band — palette strip + item count + budget + CTA.
            Sits BELOW the image on mobile (vertical stack) and as a
            horizontal band on md+. The "Shop this look" CTA is the
            most prominent because the product engagement is the
            point of this whole section. */}
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
            {render.paletteHexes.length > 0 ? (
              <div className="flex h-6 w-32 overflow-hidden rounded-full border border-editorial-border md:h-7 md:w-40">
                {render.paletteHexes.slice(0, 5).map((hex, i) => (
                  <div key={`${hex}-${i}`} className="flex-1" style={{ backgroundColor: hex }} />
                ))}
              </div>
            ) : null}
            <div className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe md:text-[11px]">
              <span className="text-editorial-ink">{render.itemCount}</span> matched items
              {render.budgetAud != null ? (
                <>
                  {' · '}
                  <span className="text-editorial-ink">
                    ${Math.round(render.budgetAud).toLocaleString('en-AU')}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <Link
            href={`/renders/${render.id}#picking-list`}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-editorial-ink px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90 md:px-6 md:py-3 md:text-[14px]"
          >
            ✦ Shop this look
          </Link>
        </div>
      </div>
    </section>
  );
}
