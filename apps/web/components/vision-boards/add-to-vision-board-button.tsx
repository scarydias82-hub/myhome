'use client';

// AddToVisionBoardButton — the universal "save this to a moodboard"
// CTA. Polymorphic across the three itemRef types (palette, trend
// card, product); the note item type is created via the AddNoteForm
// inside the board detail view instead.
//
// Behaviour mirrors AddToProjectButton (#130):
//   - 0 boards   → "Create a board" link to /vision-boards/new
//   - 1 board    → click adds straight, shows "Added ✓"
//   - 2+ boards  → click opens a small picker modal
//
// Pre-fetches the user's boards on mount so opening the picker is
// instant. Treat the duplicate response as success (the user got
// what they wanted; we don't surface "already saved" as an error).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface VisionBoardOption {
  id: string;
  name: string;
  item_count: number;
}

type RefArgs =
  | { itemType: 'palette'; paletteId: string }
  | { itemType: 'trend'; trendCardId: string }
  | { itemType: 'product'; productId: string };

interface AddToVisionBoardButtonProps {
  // NOTE: do NOT rename this to `ref` — in React 18 `ref` is a
  // reserved prop on function components, so passing it from a parent
  // would be filtered out before reaching this component, breaking
  // every save.
  itemRef: RefArgs;
  /** Optional — compact variant for tight spaces. Defaults to
   *  "comfortable". */
  variant?: 'comfortable' | 'compact';
}

type Status = 'idle' | 'adding' | 'added' | 'picker';

export function AddToVisionBoardButton({
  itemRef,
  variant = 'comfortable',
}: AddToVisionBoardButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [boards, setBoards] = useState<VisionBoardOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fetch boards on mount — the picker modal needs them and
  // they're cheap (only the user's boards, max ~10–20 rows).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/vision-boards')
      .then((r) => r.json())
      .then((j: { boards?: VisionBoardOption[] }) => {
        if (cancelled) return;
        setBoards(j.boards ?? []);
      })
      .catch(() => setBoards([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function addToBoard(boardId: string) {
    setStatus('adding');
    setError(null);
    try {
      const res = await fetch(`/api/vision-boards/${boardId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(itemRef),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not add to board.');
        setStatus('idle');
        return;
      }
      setStatus('added');
      // Auto-revert to idle after 2s so the user can re-save to a
      // different board if they want (e.g. cross-pollinating an
      // item between multiple moodboards).
      setTimeout(() => setStatus((s) => (s === 'added' ? 'idle' : s)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setStatus('idle');
    }
  }

  function handleClick() {
    if (status === 'adding' || status === 'added') return;
    if (!boards) return; // still loading
    if (boards.length === 0) {
      // The fallback Link case is handled in the JSX below — this
      // function isn't invoked when 0 boards exist.
      return;
    }
    if (boards.length === 1) {
      const only = boards[0];
      if (only) void addToBoard(only.id);
      return;
    }
    setStatus('picker');
  }

  const baseClass = cn(
    'inline-flex items-center justify-center gap-1.5 rounded-full font-mono uppercase tracking-eyebrow transition',
    variant === 'compact'
      ? 'px-2.5 py-1 text-[10px]'
      : 'px-3 py-1.5 text-meta',
  );

  // 0-boards state — show a create-a-board link, no modal needed.
  if (boards && boards.length === 0) {
    return (
      <Link
        href="/vision-boards/new"
        className={cn(
          baseClass,
          'border border-ink/15 bg-cream text-ink-soft hover:border-clay hover:text-ink',
        )}
      >
        ✦ Create a board
      </Link>
    );
  }

  // Loading state — render a neutral disabled stub so the layout
  // doesn't shift when the boards arrive.
  if (!boards) {
    return (
      <span className={cn(baseClass, 'border border-ink/[0.06] text-ink-faint opacity-50')}>
        ✦ Save to board
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'adding'}
        aria-pressed={status === 'added'}
        className={cn(
          baseClass,
          status === 'added'
            ? 'border border-olive/60 bg-olive/10 text-olive'
            : 'border border-ink/15 bg-cream text-ink hover:border-clay hover:text-clay',
        )}
      >
        {status === 'adding'
          ? '…'
          : status === 'added'
            ? '✓ Saved'
            : '✦ Save to board'}
      </button>

      {/* Picker modal — bottom sheet on mobile, centered card on md+.
          The flex layout flips alignment: items-end on mobile so the
          sheet sticks to the bottom edge; items-center on md+. */}
      {status === 'picker' ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 md:items-center md:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStatus('idle');
          }}
        >
          <div
            className={cn(
              'w-full overflow-hidden bg-cream md:max-w-md md:rounded-2xl',
              // Mobile sheet: only top corners round, full bleed to
              // screen edges, safe-area-inset padding for the home
              // indicator on iOS.
              'rounded-t-2xl pb-[env(safe-area-inset-bottom)] md:rounded-b-2xl md:pb-0',
            )}
          >
            {/* Drag-handle dimple — visual cue this is a sheet that
                can be dismissed. Mobile-only. */}
            <div className="flex justify-center pt-2 md:hidden">
              <div className="h-1 w-10 rounded-full bg-ink/15" />
            </div>
            <div className="border-b border-ink/[0.06] p-5">
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Save to which board?
              </p>
              <p className="mt-1 font-display text-h4 text-ink">Pick a vision board</p>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {boards.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => addToBoard(b.id)}
                    className="flex w-full items-center justify-between gap-3 border-b border-ink/[0.04] px-5 py-4 text-left transition hover:bg-paper-warm"
                  >
                    <span>
                      <span className="block font-display text-[15px] text-ink">{b.name}</span>
                      <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        {b.item_count} item{b.item_count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="font-mono text-meta uppercase tracking-eyebrow text-clay">
                      Save →
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <Link
                  href="/vision-boards/new"
                  className="block px-5 py-4 text-center font-mono text-meta uppercase tracking-eyebrow text-clay transition hover:bg-paper-warm"
                >
                  + Create a new board
                </Link>
              </li>
            </ul>
            <div className="border-t border-ink/[0.06] p-3 text-right">
              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="rounded-pill px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
