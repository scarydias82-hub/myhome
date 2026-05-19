'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface CompleteProjectButtonProps {
  projectId: string;
  mode: 'complete' | 'undo';
}

export function CompleteProjectButton({ projectId, mode }: CompleteProjectButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ undo: mode === 'undo' }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? 'Could not update project.');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={mode === 'complete' ? 'cta' : 'secondary'}
        size="lg"
        onClick={onClick}
        disabled={busy}
      >
        {busy
          ? '…'
          : mode === 'complete'
            ? '✓ Mark as complete'
            : '← Re-open for tweaking'}
      </Button>
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
