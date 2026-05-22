'use client';

// PaletteLikeButton — heart toggle for a single palette.
//
// Appears on every palette card (dashboard carousel, /palettes grid,
// wizard chooser). Updates optimistically: the heart fills immediately
// on click; the server response reconciles the aggregate count.
//
// Props carry the server-rendered initial state so the first paint is
// correct without a client round-trip.

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface PaletteLikeButtonProps {
  paletteId: string;
  /** Whether the current user has already liked this palette.
   *  Server-rendered from palette_likes query. */
  initialLiked: boolean;
  /** Aggregate like count at render time. */
  initialCount: number;
  /** compact = icon only (no count). comfortable = icon + count. */
  variant?: 'compact' | 'comfortable';
}

export function PaletteLikeButton({
  paletteId,
  initialLiked,
  initialCount,
  variant = 'comfortable',
}: PaletteLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    // Don't bubble into parent <Link> or <button> wrappers.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    // Optimistic update.
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => c + (nextLiked ? 1 : -1));
    setBusy(true);

    try {
      const res = await fetch(`/api/palettes/${paletteId}/like`, {
        method: 'POST',
      });
      if (res.ok) {
        const json = (await res.json()) as { liked: boolean; totalCount: number };
        // Reconcile with server truth in case of race.
        setLiked(json.liked);
        setCount(json.totalCount);
      } else {
        // Revert on error.
        setLiked(!nextLiked);
        setCount((c) => c + (nextLiked ? -1 : 1));
      }
    } catch {
      setLiked(!nextLiked);
      setCount((c) => c + (nextLiked ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={liked ? 'Unlike palette' : 'Like palette'}
        className={cn(
          'flex items-center gap-1 rounded-full border px-3 py-1.5 font-dmsans text-[11px] font-medium transition',
          liked
            ? 'border-editorial-cognac bg-editorial-cognac/10 text-editorial-cognac hover:bg-editorial-cognac/20'
            : 'border-editorial-border text-editorial-ink hover:border-editorial-borderStrong',
          busy && 'opacity-60',
        )}
      >
        <span aria-hidden>{liked ? '♥' : '♡'}</span>
        {count > 0 && <span>{count}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={liked ? 'Unlike palette' : 'Like palette'}
      className={cn(
        'flex items-center gap-2 rounded-full border px-4 py-2 font-dmsans text-[13px] font-medium transition',
        liked
          ? 'border-editorial-cognac bg-editorial-cognac/10 text-editorial-cognac hover:bg-editorial-cognac/20'
          : 'border-editorial-border text-editorial-ink hover:border-editorial-borderStrong hover:bg-editorial-surface',
        busy && 'opacity-60',
      )}
    >
      <span aria-hidden className="text-[15px]">{liked ? '♥' : '♡'}</span>
      <span>{liked ? 'Liked' : 'Like'}</span>
      {count > 0 && (
        <span className="font-dmmono text-[11px] text-editorial-taupe">{count}</span>
      )}
    </button>
  );
}
