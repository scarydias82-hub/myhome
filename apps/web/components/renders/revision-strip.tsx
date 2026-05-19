'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export interface RevisionStripItem {
  id: string;
  kind: 'original' | 'staged' | 'multi_staged';
  label: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface RevisionStripProps {
  renderId: string;
  revisions: RevisionStripItem[];
  activeRevisionId: string | null;
}

// Horizontal strip of revision thumbnails below the before/after slider.
// Click any to make it the active view (revert or roll forward). No fal
// calls — pure pointer flip via PATCH /api/renders/[id]/revisions.
//
// Active revision is highlighted with a cognac border + "Active" chip.
// Hides itself when there's only one revision (the original) — strip is
// only useful once at least one staging has landed.
export function RevisionStrip({ renderId, revisions, activeRevisionId }: RevisionStripProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (revisions.length <= 1) return null;

  async function activate(id: string) {
    if (id === activeRevisionId || isPending) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/renders/${renderId}/revisions`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch revision.');
      setPendingId(null);
    }
  }

  return (
    <section className="mt-10 rounded-2xl border border-editorial-border bg-editorial-surface p-6 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-cognac">
            Revision history
          </p>
          <h3 className="mt-1 font-serif text-[20px] font-medium leading-tight text-editorial-ink">
            {revisions.length} versions of this render
          </h3>
        </div>
        <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
          Tap to revert or roll forward
        </p>
      </div>

      <ul className="mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {revisions.map((r) => {
          const active = r.id === activeRevisionId;
          const busy = pendingId === r.id;
          return (
            <li key={r.id} className="snap-start">
              <button
                type="button"
                onClick={() => activate(r.id)}
                disabled={busy}
                aria-current={active ? 'true' : 'false'}
                className={[
                  'group relative flex w-[148px] shrink-0 flex-col overflow-hidden rounded-xl border-2 bg-editorial-cream text-left transition',
                  active
                    ? 'border-editorial-cognac shadow-pop'
                    : 'border-editorial-border hover:border-editorial-borderStrong',
                  busy ? 'opacity-60' : '',
                ].join(' ')}
              >
                <div className="relative aspect-[4/3] w-full bg-editorial-surface">
                  {r.imageUrl ? (
                    <Image
                      src={r.imageUrl}
                      alt={r.label ?? `Revision ${r.kind}`}
                      fill
                      sizes="148px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-taupe">
                      no thumbnail
                    </div>
                  )}
                  {active ? (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-editorial-cognac px-2 py-0.5 font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-ink">
                      Active
                    </span>
                  ) : null}
                </div>
                <div className="px-3 pt-2 pb-3">
                  <p className="font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-taupe">
                    {labelForKind(r.kind)}
                  </p>
                  <p className="mt-1 line-clamp-2 font-serif text-[13px] leading-tight text-editorial-ink">
                    {r.label ?? 'Untitled revision'}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="mt-3 font-dmsans text-[12px] text-editorial-cognac">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function labelForKind(kind: 'original' | 'staged' | 'multi_staged'): string {
  if (kind === 'original') return 'Original';
  if (kind === 'multi_staged') return 'Multi-stage';
  return 'Staged';
}
