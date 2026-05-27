'use client';

// "Try again" button on the failed-render page (PR #78). Re-submits
// the original /api/render POST body (stored on the renders row's
// submit_params column), then navigates to the new render's page.
// Lets the user recover from transient render failures with one
// click rather than re-uploading + re-picking everything.
//
// Renders nothing when submitParams is null — happens on rows
// predating the 20260527010000 migration, or when the migration
// hasn't applied. Failed-state page falls back to the existing
// "Try another render" link (which goes to /rooms/new) in that
// case.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface TryAgainButtonProps {
  /** The original /api/render request body. Re-POSTed verbatim. */
  submitParams: Record<string, unknown> | null;
}

export function TryAgainButton({ submitParams }: TryAgainButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No submit_params = retry is impossible. The failed-state page
  // shows the existing "Try another render" link in this case.
  if (!submitParams) return null;

  async function handleRetry() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submitParams),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !json.id) {
        setError(
          json.error ??
            'Could not start the render. Please try again in a few minutes.',
        );
        setSubmitting(false);
        return;
      }
      router.push(`/renders/${json.id}`);
    } catch {
      setError('Network error. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        type="button"
        variant="cta"
        size="lg"
        onClick={handleRetry}
        disabled={submitting}
      >
        {submitting ? 'Restarting render…' : '↻ Try again'}
      </Button>
      {error ? (
        <p className="text-[13px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
