'use client';

// Small "Rebuild picking list" affordance for the render page.
// Triggers POST /api/renders/[id]/build-picking-list with force=true,
// then refreshes the page so the new picking list (which can include
// new pseudo-items like wall paint that older renders never had a
// chance to include) shows up. No fal credits spent — just Florence-2,
// Claude validator, Claude ranker.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  renderId: string;
}

export function RebuildPickingListButton({ renderId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  async function rebuild() {
    setBusy(true);
    setError(null);
    setDoneCount(null);
    try {
      const res = await fetch(`/api/renders/${renderId}/build-picking-list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        items?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDoneCount(json.items ?? 0);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rebuild failed');
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? 'Rebuilding…'
    : doneCount !== null
      ? `Rebuilt — ${doneCount} items`
      : 'Rebuild picking list';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={rebuild}
        disabled={busy || isPending}
        className="rounded-pill border border-ink/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink disabled:opacity-50"
        title="Re-run detection + matching against the current render. No new fal call."
      >
        {label}
      </button>
      {error ? (
        <p className="font-mono text-meta uppercase tracking-eyebrow text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
