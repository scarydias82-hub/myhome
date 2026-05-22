'use client';

// Preferences modal — captures the canonical user-level taste signal
// (§6.11 Phase A, #153). Two callers:
//
//   1. Onboarding — dashboard renders this with open=true and
//      isFirstTime=true when users.preferences IS NULL. Modal can't be
//      dismissed by clicking the backdrop on first run; user has to
//      either complete or hit "Skip for now".
//   2. Edit — dashboard's PreferencesSection renders this with
//      open=true (controlled) when the user clicks "Edit". Standard
//      modal — backdrop dismisses, Esc closes.
//
// Both modes save by PUT /api/preferences. Successful save closes the
// modal and refreshes the route so the dashboard section shows the
// new chips.
//
// Uses the same BRIEF_TAG_GROUPS taxonomy as the project wizard so the
// vocabulary stays consistent between user-level prefs and project-
// level briefs.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { BRIEF_TAG_GROUPS, type BriefTagGroup } from '@/lib/brief/taxonomy';

interface PreferencesModalProps {
  open: boolean;
  /** Initial selected tags. Pass [] on first-time onboarding. */
  initialTags: string[];
  /** First-run mode shows different copy and disables backdrop-dismiss. */
  isFirstTime?: boolean;
  /** Called when the user closes the modal (save, skip, or dismiss). */
  onClose: () => void;
}

export function PreferencesModal({
  open,
  initialTags,
  isFirstTime = false,
  onClose,
}: PreferencesModalProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialTags));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset selection whenever the modal re-opens with new initial tags.
  useEffect(() => {
    if (open) setSelected(new Set(initialTags));
  }, [open, initialTags]);

  // Esc to close (edit mode only — first-time onboarding requires an
  // explicit action so the user doesn't bounce out without setting prefs).
  useEffect(() => {
    if (!open || isFirstTime) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isFirstTime, onClose]);

  if (!open) return null;

  function toggleTag(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0) {
      setError('Pick at least one tag — your preferences are the foundation of every recommendation.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: [...selected] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not save preferences. Try again.');
        return;
      }
      // Refresh so the dashboard section picks up the new chips.
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function skipForNow() {
    // First-time path: leaves users.preferences null. Dashboard will
    // re-prompt on next login. Lower-friction than forcing completion.
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center"
      // Backdrop click dismisses in edit mode only. First-time mode
      // requires an explicit "Skip for now" or "Save" action.
      onClick={(e) => {
        if (!isFirstTime && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-cream shadow-soft sm:max-w-3xl sm:rounded-2xl"
      >
        <header className="border-b border-ink/[0.06] px-6 py-5 md:px-8">
          <Eyebrow>{isFirstTime ? 'Welcome to myMaison' : 'My preferences'}</Eyebrow>
          <h2
            id="prefs-title"
            className="mt-2 font-display text-h3 text-ink md:text-[28px]"
          >
            {isFirstTime
              ? 'Tell us how you live.'
              : 'Update your preferences.'}
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            {isFirstTime
              ? 'Pick the tags that resonate. Your preferences become the foundation of every render and recommendation — you can change them anytime from the dashboard, and override them per project or per photo.'
              : 'Your preferences are inherited by new projects and by photos uploaded outside a project. Changes here don’t touch existing projects (those keep their own brief).'}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
          <div className="space-y-8">
            {BRIEF_TAG_GROUPS.map((group) => (
              <TagGroupSection
                key={group.category}
                group={group}
                selected={selected}
                onToggle={toggleTag}
              />
            ))}
          </div>
        </div>

        {error ? (
          <div className="border-t border-destructive/30 bg-destructive/5 px-6 py-3 md:px-8">
            <p className="text-[13px] text-destructive">{error}</p>
          </div>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] px-6 py-4 md:px-8">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {selected.size} tag{selected.size === 1 ? '' : 's'} selected
          </p>
          <div className="flex flex-wrap gap-2">
            {isFirstTime ? (
              <button
                type="button"
                onClick={skipForNow}
                disabled={busy}
                className="rounded-pill border border-ink/15 px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
              >
                Skip for now
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-pill border border-ink/15 px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={busy || selected.size === 0}
              className="rounded-pill bg-ink px-5 py-2 font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:bg-ink-soft disabled:opacity-40"
            >
              {busy ? 'Saving…' : isFirstTime ? 'Save and continue' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function TagGroupSection({
  group,
  selected,
  onToggle,
}: {
  group: BriefTagGroup;
  selected: Set<string>;
  onToggle: (slug: string) => void;
}) {
  const pickedInGroup = group.tags.filter((t) => selected.has(t.slug)).length;
  const overCap = pickedInGroup > group.suggestedMax;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Eyebrow>{group.label}</Eyebrow>
          <p className="mt-1 font-display text-[18px] text-ink md:text-[20px]">
            {group.prompt}
          </p>
        </div>
        <p
          className={cn(
            'font-mono text-meta uppercase tracking-eyebrow',
            overCap ? 'text-clay' : 'text-ink-faint',
          )}
        >
          {pickedInGroup} / ~{group.suggestedMax}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {group.tags.map((tag) => {
          const isSelected = selected.has(tag.slug);
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => onToggle(tag.slug)}
              aria-pressed={isSelected}
              title={tag.hint ?? undefined}
              className={cn(
                'rounded-pill border px-4 py-2 text-[13px] transition',
                isSelected
                  ? 'border-clay/50 bg-clay/15 text-ink shadow-sm'
                  : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
              )}
            >
              {tag.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
