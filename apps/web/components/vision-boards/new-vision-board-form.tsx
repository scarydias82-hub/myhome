'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NewVisionBoardForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the board a name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/vision-boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? 'Could not create board.');
        setSubmitting(false);
        return;
      }
      router.push(`/vision-boards/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Board name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Summer living room"
          autoComplete="off"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-[13px] text-ink-soft">
          Pick something specific — &ldquo;Master bedroom refresh&rdquo;, &ldquo;Coastal
          kitchen&rdquo;, &ldquo;Hamptons-inspired ensuite&rdquo;.
        </p>
      </div>
      {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
      <Button type="submit" variant="cta" size="lg" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create board'}
      </Button>
    </form>
  );
}
