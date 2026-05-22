'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type RenderStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type PickingListStatus = 'not_started' | 'building' | 'ready' | 'failed';

interface RenderPollProps {
  renderId: string;
  // Initial render status from the server-rendered page.
  initialStatus: RenderStatus;
  // Initial picking-list build status. Null/missing on legacy rows
  // (pre-2026-05-22 migration) — treat as 'ready' if the page already
  // has picking list content, otherwise 'not_started'.
  initialPickingListStatus?: PickingListStatus | null;
  createdAt: string;
}

// Tightened from 3000ms → 1500ms on 2026-05-22 to cut perceived
// "render done" latency. The render typically completes 0-3s before
// the user sees it because polling is the choke point at the end.
// MAX_POLLS bumped 80 → 160 to keep the same ~4 minute wall-clock
// budget for queue + render + matching.
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 160;

function isRenderTerminal(s: RenderStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'cancelled';
}
function isPickingListTerminal(s: PickingListStatus): boolean {
  return s === 'ready' || s === 'failed';
}

// Lightweight client poller. Two-stage completion model (2026-05-22):
// the render image and the picking list resolve independently. Image
// arrives at ~T+30, picking list at ~T+60. We poll until BOTH are
// terminal, and router.refresh() on each transition so the page
// progressively reveals content.
export function RenderPoll({
  renderId,
  initialStatus,
  initialPickingListStatus,
  createdAt,
}: RenderPollProps) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)),
  );
  const [falStatus, setFalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialPLS: PickingListStatus = initialPickingListStatus ?? 'not_started';

  useEffect(() => {
    // Don't poll if everything is already done at mount.
    if (isRenderTerminal(initialStatus) && isPickingListTerminal(initialPLS)) return;
    let cancelled = false;
    let polls = 0;
    // Track last-seen states locally so we can detect transitions and
    // call router.refresh() exactly once per transition.
    let lastRender: RenderStatus = initialStatus;
    let lastPicking: PickingListStatus = initialPLS;

    const tick = () => setSeconds((s) => s + 1);
    const secondTimer = setInterval(tick, 1000);

    async function poll() {
      if (cancelled) return;
      polls++;
      try {
        const res = await fetch(`/api/renders/${renderId}/status`);
        const json = (await res.json().catch(() => ({}))) as {
          status?: RenderStatus;
          falStatus?: string;
          pickingListStatus?: PickingListStatus;
          error?: string;
        };
        if (cancelled) return;
        setFalStatus(json.falStatus ?? null);

        const nextRender = json.status ?? lastRender;
        const nextPicking = json.pickingListStatus ?? lastPicking;

        // Image-done transition: render flipped to terminal. Refresh
        // so the page server-component re-fetches and shows the
        // rendered image.
        if (!isRenderTerminal(lastRender) && isRenderTerminal(nextRender)) {
          router.refresh();
        }

        // Picking-list-done transition: matching flipped to terminal.
        // Refresh again so the page shows the populated list (or the
        // failure state).
        if (!isPickingListTerminal(lastPicking) && isPickingListTerminal(nextPicking)) {
          router.refresh();
        }

        lastRender = nextRender;
        lastPicking = nextPicking;

        if (isRenderTerminal(nextRender) && isPickingListTerminal(nextPicking)) {
          return;
        }
        if (json.error) setError(json.error);
      } catch (err) {
        if (cancelled) return;
        console.error('poll failed', err);
      }
      if (polls >= MAX_POLLS) {
        setError('Render took too long. Refresh to check status.');
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(secondTimer);
    };
  }, [renderId, initialStatus, initialPLS, router]);

  // The "Restyling your room..." placeholder only shows while the
  // image itself is still rendering. Once status flips to terminal,
  // the page renders the image and (if relevant) a small "finding
  // matches" indicator handled elsewhere in the page UI.
  if (isRenderTerminal(initialStatus)) return null;

  return (
    <div className="grid place-items-center rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-16 text-center">
      <div className="h-3 w-40 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
      </div>
      <p className="mt-6 font-display text-h4 text-ink">Restyling your room…</p>
      <p className="mt-2 max-w-md text-[14px] text-ink-soft">
        Started {seconds}s ago · {falLabel(falStatus)} · auto-refreshes when done.
      </p>
      {error ? (
        <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function falLabel(falStatus: string | null): string {
  if (falStatus === 'in_queue') return 'in fal queue';
  if (falStatus === 'in_progress') return 'flux generating';
  return 'submitting';
}
