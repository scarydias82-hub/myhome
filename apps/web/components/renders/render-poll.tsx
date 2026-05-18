'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface RenderPollProps {
  renderId: string;
  // Initial status from the server-rendered page. Used to decide whether to
  // start polling at all (terminal statuses skip the polling loop).
  initialStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 80; // ~4 minutes — enough for queue + render + finalise

// Lightweight client poller that hits /api/renders/[id]/status until the
// render is in a terminal state, then refreshes the server page so the new
// data renders. Shown alongside the placeholder while running.
export function RenderPoll({ renderId, initialStatus, createdAt }: RenderPollProps) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)),
  );
  const [falStatus, setFalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus !== 'running' && initialStatus !== 'queued') return;
    let cancelled = false;
    let polls = 0;

    const tick = () => setSeconds((s) => s + 1);
    const secondTimer = setInterval(tick, 1000);

    async function poll() {
      if (cancelled) return;
      polls++;
      try {
        const res = await fetch(`/api/renders/${renderId}/status`);
        const json = (await res.json().catch(() => ({}))) as {
          status?: string;
          falStatus?: string;
          error?: string;
        };
        if (cancelled) return;
        setFalStatus(json.falStatus ?? null);
        if (json.status === 'succeeded' || json.status === 'failed' || json.status === 'cancelled') {
          // Refresh the server component so the final render + picking list
          // render properly.
          router.refresh();
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
  }, [renderId, initialStatus, router]);

  if (initialStatus !== 'running' && initialStatus !== 'queued') return null;

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
