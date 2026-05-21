'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// When this form is invoked with `?visionBoardId=X`, we treat the
// project as a board-to-project conversion (Phase 3, #136):
//   • Pre-fill the project name from the board name
//   • Show a "Seeded from board" callout so the user knows their
//     saved palettes / trends / products will pre-populate the brief
//   • The POST request includes visionBoardId so the server can
//     persist source_board_id and seed projects.brief from the board

interface BoardSummary {
  id: string;
  name: string;
  item_count: number;
}

export function NewProjectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const visionBoardId = searchParams?.get('visionBoardId') ?? null;

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardSummary | null>(null);

  // Pre-fetch the board summary when we have a visionBoardId so we
  // can pre-fill the name + surface the "seeded from board" callout.
  useEffect(() => {
    if (!visionBoardId) return;
    let cancelled = false;
    fetch(`/api/vision-boards/${visionBoardId}`)
      .then((r) => r.json())
      .then((j: { board?: BoardSummary }) => {
        if (cancelled) return;
        if (j.board) {
          setBoard(j.board);
          setName(j.board.name);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visionBoardId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          visionBoardId: visionBoardId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? 'Could not create project.');
        setSubmitting(false);
        return;
      }
      router.push(`/projects/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {board ? (
        <div className="rounded-lg border border-clay/30 bg-clay/5 p-4">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Seeded from your vision board
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            We&apos;ll pre-fill the brief with the <strong>{board.item_count} item
            {board.item_count === 1 ? '' : 's'}</strong> from{' '}
            <strong>{board.name}</strong>. You&apos;ll still walk through the wizard, but the
            palette and product preferences are already set.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">Project name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Living room refresh"
          autoComplete="off"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-[13px] text-ink-soft">
          Make it specific. You can edit later.
        </p>
      </div>
      {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
      <Button type="submit" variant="cta" size="lg" disabled={submitting}>
        {submitting ? 'Creating…' : board ? 'Create project from board' : 'Create project'}
      </Button>
    </form>
  );
}
