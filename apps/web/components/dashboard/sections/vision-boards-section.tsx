'use client';

// Vision boards strip — Phase 1 ships the section frame with empty-
// state messaging, anticipating Phase 2 where boards become real
// (#135). When a user has zero boards we surface a "Create your first
// vision board" CTA + an explainer of what boards do. When they have
// boards we render them as a horizontal carousel of cover-cards.
//
// Empty-state copy is deliberately *aspirational* — "build a board"
// reads as the lower-commitment alternative to "start a project" so
// it captures users who aren't ready to upload a room photo yet.

import Image from 'next/image';
import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';

export interface VisionBoardCard {
  id: string;
  name: string;
  itemCount: number;
  coverImageUrl: string | null;
  /** Up to 4 palette/product cover thumbnails for an empty-cover
   *  state — shown as a 2x2 grid so the board feels populated. */
  itemThumbnails: string[];
  updatedAt: string;
}

interface VisionBoardsSectionProps {
  boards: VisionBoardCard[];
}

export function VisionBoardsSection({ boards }: VisionBoardsSectionProps) {
  if (boards.length === 0) {
    return (
      <section id="vision-boards" className="py-8 md:py-10">
        <SectionHeader title="Your vision boards" />
        <Link
          href="/vision-boards/new"
          className="group flex flex-col items-start gap-4 rounded-2xl border border-dashed border-editorial-borderStrong bg-editorial-surface p-6 transition hover:border-editorial-cognac md:flex-row md:items-center md:gap-6 md:p-8"
        >
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-editorial-cream font-serif text-[20px] text-editorial-cognac md:h-14 md:w-14 md:text-[24px]">
            ✦
          </div>
          <div className="flex-1">
            <p className="font-serif text-[18px] leading-tight text-editorial-ink md:text-[22px]">
              Build a vision board first
            </p>
            <p className="mt-2 max-w-xl font-dmsans text-[12px] leading-relaxed text-editorial-taupe md:text-[13px]">
              Save palettes, trends, and products you love into a single board. When you're
              ready, turn it into a project and we'll restyle your room around it.
            </p>
          </div>
          <span className="rounded-full bg-editorial-ink px-4 py-2 font-dmsans text-[12px] font-medium text-editorial-cream transition group-hover:opacity-90 md:px-5 md:py-2.5 md:text-[13px]">
            ✦ Create a board
          </span>
        </Link>
      </section>
    );
  }

  return (
    <section id="vision-boards" className="py-8 md:py-10">
      <SectionHeader
        title="Your vision boards"
        action={{ label: '+ New board', href: '/vision-boards/new' }}
      />
      <div className="-mx-4 overflow-x-auto pb-3 md:-mx-2 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-3 px-4 md:gap-4 md:px-2">
          {boards.map((b) => (
            <li
              key={b.id}
              className="snap-start shrink-0 basis-[240px] md:basis-[280px]"
            >
              <BoardCard board={b} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BoardCard({ board: b }: { board: VisionBoardCard }) {
  return (
    <Link
      href={`/vision-boards/${b.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border bg-editorial-surface transition hover:border-editorial-borderStrong"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-editorial-cream">
        {b.coverImageUrl ? (
          <Image
            src={b.coverImageUrl}
            alt={b.name}
            fill
            sizes="(max-width: 768px) 60vw, 280px"
            className="object-cover transition group-hover:scale-[1.02]"
            unoptimized
          />
        ) : b.itemThumbnails.length > 0 ? (
          // 2x2 thumbnail grid when no cover image — gives the board
          // a sense of "this contains stuff" even without a hero.
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-editorial-border">
            {b.itemThumbnails.slice(0, 4).map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="relative overflow-hidden bg-editorial-cream"
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="140px"
                  className="object-cover"
                  unoptimized
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid h-full place-items-center font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
            Empty board
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="font-serif text-[16px] leading-tight text-editorial-ink md:text-[17px]">
          {b.name}
        </p>
        <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          {b.itemCount} item{b.itemCount === 1 ? '' : 's'}
        </p>
      </div>
    </Link>
  );
}
