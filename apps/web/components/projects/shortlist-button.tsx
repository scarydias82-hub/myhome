'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ShortlistButtonProps {
  projectId: string | null;
  kind: 'render' | 'staged' | 'product';
  sourceId: string | null;
  label?: string;
  className?: string;
}

// Add-to-shortlist button. Optimistic state change + auto-disabled when
// either the project or source ID is missing (e.g. render not yet linked
// to a project). Toast on confirmation lives in the parent if needed.
export function ShortlistButton({
  projectId,
  kind,
  sourceId,
  label = 'Add to shortlist',
  className,
}: ShortlistButtonProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const disabled = state === 'busy' || state === 'done' || !projectId || !sourceId;

  async function onClick() {
    if (!projectId || !sourceId) return;
    setState('busy');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/shortlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, sourceId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(json.error ?? 'Could not shortlist.');
        setState('error');
        return;
      }
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  }

  return (
    <div className={cn('inline-flex flex-col items-start gap-1', className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={state === 'done'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
          state === 'done'
            ? 'bg-olive/15 text-olive'
            : 'bg-ink text-paper hover:opacity-90 disabled:opacity-40',
        )}
      >
        {state === 'done' ? '✓ Shortlisted' : state === 'busy' ? '…' : `+ ${label}`}
      </button>
      {errorMsg ? <p className="text-[12px] text-destructive">{errorMsg}</p> : null}
      {!projectId ? (
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Link this render to a project to shortlist
        </p>
      ) : null}
    </div>
  );
}
