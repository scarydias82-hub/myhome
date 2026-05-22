'use client';

// Palette card — swatch strip + persona meta + Shop/Project/Save CTAs.
// Shared between the dashboard's palette carousel and the dedicated
// /palettes page. Keep the visual contract stable since both surfaces
// are paged horizontally on mobile.

import Link from 'next/link';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';
import { PaletteLikeButton } from '@/components/palettes/palette-like-button';

export interface PaletteCardData {
  id: string;
  name: string;
  vibe: string;
  trendSource: string;
  swatchHexes: string[];
  timelessness: number;
  personaFit: string[];
  recommendedRooms: string[];
  /** Aggregate like count across all users (palette_likes table). 0 cold-start. */
  likeCount: number;
  /** Whether the currently-signed-in user has liked this palette. */
  likedByUser: boolean;
}

export function PaletteSwatchCard({ palette: p }: { palette: PaletteCardData }) {
  // Background tint pulled from the palette so each card has a subtle
  // hint of the colour story even before you focus on the swatches.
  const tintCss = `linear-gradient(135deg, ${p.swatchHexes[0] ?? '#F4EFE6'}1A 0%, ${p.swatchHexes[2] ?? '#C4956A'}10 100%)`;
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-editorial-border transition hover:border-editorial-borderStrong"
      style={{ background: tintCss }}
    >
      {/* Big swatch strip = the visual anchor. Each colour gets equal
          space so the palette's tonal range is readable at a glance. */}
      <div className="grid h-32 grid-cols-5">
        {p.swatchHexes.slice(0, 5).map((hex, i) => (
          <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          T {p.timelessness}/10 · {p.personaFit.slice(0, 2).join(' · ')}
        </p>
        <p className="font-serif text-[18px] leading-tight text-editorial-ink">{p.name}</p>
        <p className="line-clamp-2 font-dmsans text-[12px] leading-relaxed text-editorial-taupe">
          {p.vibe}
        </p>
        <p className="mt-auto line-clamp-1 font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
          {p.trendSource}
        </p>
        {/* Shop is primary (products-first); start a project is the
            secondary path; Save to board is the lowest-commitment
            "I like this" action. Reflects the dashboard's product-
            led IA + the moodboard funnel from Phase 2. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/catalogue?palette=${p.id}`}
            className="rounded-full bg-editorial-ink px-3 py-1.5 font-dmsans text-[11px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            ✦ Shop this palette
          </Link>
          <Link
            href={`/projects/new?palette=${p.id}`}
            className="rounded-full border border-editorial-borderStrong px-3 py-1.5 font-dmsans text-[11px] font-medium text-editorial-ink transition hover:bg-editorial-cream"
          >
            Start a project
          </Link>
          <PaletteLikeButton
            paletteId={p.id}
            initialLiked={p.likedByUser}
            initialCount={p.likeCount}
            variant="compact"
          />
          <AddToVisionBoardButton
            itemRef={{ itemType: 'palette', paletteId: p.id }}
            variant="compact"
          />
        </div>
      </div>
    </article>
  );
}
