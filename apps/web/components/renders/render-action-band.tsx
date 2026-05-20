'use client';

// End-of-render action band (#107). Sits at the bottom of a completed
// render page with three follow-up moves so the user has a clear next
// step after the wow moment. Closes the loop instead of leaving them
// at the bottom of a long scroll with nothing to do.
//
//  Try another palette  — re-renders the same room. Today we send the
//                         user back to /rooms/new (with projectId so
//                         the new render still lands in their project).
//                         Future: deep-link with roomId so they skip
//                         the upload step.
//  Share this look      — copies the current URL. Public access is
//                         beta-gated server-side so a friend would
//                         need their own login; the share copy makes
//                         that clear.
//  Add render to review — the same shortlist action that lives in the
//                         header, but bigger and obvious at the
//                         decision moment. Shortlist is project-bound,
//                         so we render it as a link rather than the
//                         button component to keep this surface
//                         self-contained.

import { useState } from 'react';
import Link from 'next/link';
import { Eyebrow } from '@/components/saltbush/eyebrow';

export function RenderActionBand({
  renderId,
  projectId,
}: {
  renderId: string;
  projectId: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyShareUrl() {
    setCopyError(null);
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      if (!url) throw new Error('no url');
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Reset the chip after a few seconds so the user can copy again
      // if they want.
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'copy failed');
    }
  }

  // /rooms/new doesn't yet support reusing an existing room — we send
  // the user back to the upload step, scoped to their project so the
  // next render lands in the same place. TODO: thread roomId through
  // for a true "skip to palette" path.
  const newRenderHref = projectId ? `/rooms/new?projectId=${projectId}` : '/rooms/new';
  const reviewHref = projectId ? `/projects/${projectId}` : '/dashboard';

  return (
    <section className="mt-14 rounded-2xl border border-ink/[0.06] bg-cream/60 p-6 md:p-10">
      <Eyebrow>What next</Eyebrow>
      <p className="mt-2 max-w-xl font-display text-h3 text-ink">
        Three ways to keep going.
      </p>
      <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
        Compare another palette in the same room, share the look with someone, or save this
        render to your project to review later.
      </p>
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <Link
          href={newRenderHref}
          className="group relative overflow-hidden rounded-xl border border-ink/15 bg-paper p-5 transition hover:border-clay/40 hover:bg-cream"
        >
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Try another palette
          </p>
          <p className="mt-2 font-display text-h4 text-ink">
            Re-render this room
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            Pick a different colour direction and see the same space restyled.
          </p>
        </Link>

        <button
          type="button"
          onClick={copyShareUrl}
          className="group relative overflow-hidden rounded-xl border border-ink/15 bg-paper p-5 text-left transition hover:border-clay/40 hover:bg-cream"
          aria-live="polite"
        >
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            {copied ? 'Link copied · share away' : 'Share this look'}
          </p>
          <p className="mt-2 font-display text-h4 text-ink">
            {copied ? 'Copied to clipboard' : 'Copy a link to send'}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {copyError
              ? `Couldn't copy automatically — select the URL bar and copy. (${copyError})`
              : 'Friends with a login can open the same render and the picking list.'}
          </p>
        </button>

        <Link
          href={reviewHref}
          className="group relative overflow-hidden rounded-xl border border-clay/40 bg-cream p-5 shadow-soft transition hover:border-clay/60 hover:bg-paper"
        >
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Save to {projectId ? 'project' : 'your dashboard'}
          </p>
          <p className="mt-2 font-display text-h4 text-ink">
            Review render #{renderId.slice(0, 6)}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            Open your {projectId ? 'project' : 'dashboard'} to keep building toward a final
            scheme.
          </p>
        </Link>
      </div>
    </section>
  );
}
