'use client';

// Preferences modal — captures the canonical user-level taste signal
// (§6.11 Phase A, #153). Three callers:
//
//   1. Onboarding — dashboard renders this with open=true and
//      isFirstTime=true when users.preferences IS NULL. Modal cannot
//      be dismissed by clicking the backdrop, hitting Esc, or any
//      "Skip" affordance — the user MUST pick at least one tag and
//      save. The "Skip for now" affordance was removed on
//      2026-05-22 (#164) as a one-time soft-launch coercion: with
//      closed-beta locked, the only users hitting this modal are
//      legacy accounts created before #153 shipped, and we want
//      their preference-aware code paths (#156 ranker + #163
//      carousel fallback) to actually start firing for them. When
//      public signups open, revisit whether the no-skip behaviour
//      should stay or be replaced with a softer "Remind me later".
//   2. Edit — dashboard's HeroGreeting renders this with
//      open=true (controlled) when the user clicks the "Edit →" pill
//      in the taste-signal chip row. Standard modal — backdrop
//      dismisses, Esc closes.
//   3. Per-render override — /rooms/new's UploadForm renders this with
//      persistMode='per-render' so saves return tags via
//      onSaveOverride() instead of PUT-ing to /api/preferences.
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
  /** What "Save" writes to (§6.11 Phase C, #155):
   *   - 'canonical' (default): PUT /api/preferences. Writes the user's
   *     canonical taste signal — used by onboarding + dashboard edit.
   *   - 'per-render': skip the PUT; just hand the tags back via
   *     onSaveOverride(). Used by the analyse page's "Customise for
   *     this image" flow — the override applies to one recommendation
   *     and never persists. */
  persistMode?: 'canonical' | 'per-render';
  /** Required when persistMode === 'per-render'. Receives the chosen
   *  tags so the caller can re-fire /api/recommend with overrideTags. */
  onSaveOverride?: (tags: string[]) => void;
}

export function PreferencesModal({
  open,
  initialTags,
  isFirstTime = false,
  onClose,
  persistMode = 'canonical',
  onSaveOverride,
}: PreferencesModalProps) {
  const isPerRender = persistMode === 'per-render';
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

    // Per-render override: don't touch users.preferences, just hand
    // the tags back to the caller so they can re-fire /api/recommend
    // with overrideTags. The override applies to one recommendation
    // and lives nowhere persistent.
    if (isPerRender) {
      onSaveOverride?.([...selected]);
      onClose();
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
          <Eyebrow>
            {isPerRender
              ? 'Customise for this image'
              : isFirstTime
                ? 'Welcome to myMaison'
                : 'My preferences'}
          </Eyebrow>
          <h2
            id="prefs-title"
            className="mt-2 font-display text-h3 text-ink md:text-[28px]"
          >
            {isPerRender
              ? 'Override your preferences for this image.'
              : isFirstTime
                ? 'Tell us how you live.'
                : 'Update your preferences.'}
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            {isPerRender
              ? "Pick the tags you want the designer to read for this image only. Your saved preferences on the dashboard won't change — to update those, edit them from the dashboard."
              : isFirstTime
                ? 'Pick the tags that resonate. Your preferences become the foundation of every render and recommendation. You can change them anytime from the dashboard, and override them per project or per photo — but pick at least one now so the next render is genuinely yours.'
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
            {/* #164 — "Skip for now" removed on first-time onboarding.
                Closed-beta is locked, and the only users hitting this
                modal are legacy accounts created before #153 — we
                want their preference-aware paths (#156 + #163) to
                actually start firing. They must pick at least one tag
                to dismiss the modal. Edit mode (isFirstTime=false)
                keeps the Cancel button so saved users aren't trapped
                when they open prefs to look but not change anything. */}
            {!isFirstTime ? (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-pill border border-ink/15 px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={busy || selected.size === 0}
              className="rounded-pill bg-ink px-5 py-2 font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:bg-ink-soft disabled:opacity-40"
            >
              {busy
                ? 'Saving…'
                : isPerRender
                  ? 'Use these for this image'
                  : isFirstTime
                    ? 'Save and continue'
                    : 'Save'}
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
