'use client';

// Dashboard "My Preferences" surface (§6.11 Phase A, #153). Lives
// between HeroGreeting and ProjectsSection — Option A placement
// confirmed by the owner: visible, dedicated row, reinforces "your
// taste is the foundation of every render".
//
// Two states:
//   - preferences IS NULL → onboarding mode. The PreferencesModal is
//     rendered with isFirstTime + open=true so the user sets prefs on
//     first dashboard load. The section itself shows a soft prompt
//     card behind the modal.
//   - preferences exists → editor mode. Section shows current chips
//     and an "Edit →" affordance. Clicking opens the PreferencesModal
//     in normal mode.
//
// Inheritance rules (documented for the team; enforced elsewhere):
//   - New projects: project.brief.tags snapshots from preferences.tags
//     at create time. Editing the project's brief doesn't touch here.
//   - Outside-project uploads: /api/analyse-room reads preferences as
//     taste signal. Per-render override allowed in the UI but doesn't
//     persist back.
//   - This component is the ONLY place that writes preferences.

import { useState } from 'react';
import Link from 'next/link';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { BRIEF_TAG_GROUPS } from '@/lib/brief/taxonomy';
import { PreferencesModal } from '@/components/dashboard/preferences-modal';

interface UserPreferences {
  tags: string[];
  updated_at: string;
}

interface PreferencesSectionProps {
  preferences: UserPreferences | null;
}

// Build a label-lookup once so we can render chips as the human label
// ("Modern organic") rather than the slug ("modern-organic").
const TAG_LABEL_BY_SLUG: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const group of BRIEF_TAG_GROUPS) {
    for (const tag of group.tags) {
      map[tag.slug] = tag.label;
    }
  }
  return map;
})();

export function PreferencesSection({ preferences }: PreferencesSectionProps) {
  const isFirstTime = preferences === null;
  // Modal opens automatically on first visit when prefs aren't set.
  const [open, setOpen] = useState<boolean>(isFirstTime);

  const tagCount = preferences?.tags.length ?? 0;
  const displayChips = preferences?.tags.slice(0, 8) ?? [];
  const overflow = tagCount - displayChips.length;

  return (
    <>
      <section className="rounded-2xl border border-ink/[0.06] bg-paper-warm bg-grain p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow>My preferences</Eyebrow>
            <p className="mt-2 font-display text-h4 leading-tight text-ink md:text-[22px]">
              {isFirstTime
                ? 'Set the taste signal for every render.'
                : 'Your taste, on file.'}
            </p>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
              {isFirstTime
                ? 'A quick tag pick — what you love, what you avoid — so every render starts from your direction, not a blank slate.'
                : 'New projects and outside-project photo uploads inherit these. Existing projects keep their own brief. Update anytime.'}
            </p>

            {!isFirstTime && displayChips.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {displayChips.map((slug) => (
                  <span
                    key={slug}
                    className="rounded-pill border border-ink/15 bg-cream px-3 py-1 text-[12px] text-ink"
                  >
                    {TAG_LABEL_BY_SLUG[slug] ?? slug}
                  </span>
                ))}
                {overflow > 0 ? (
                  <span className="rounded-pill px-3 py-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                    +{overflow} more
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-pill border border-ink/15 bg-cream px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink transition hover:border-ink/30"
          >
            {isFirstTime ? 'Set up →' : 'Edit →'}
          </button>
        </div>

        {!isFirstTime && preferences ? (
          <p className="mt-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Last updated {new Date(preferences.updated_at).toLocaleDateString('en-AU')}
            {' · '}
            <Link
              href="/dashboard"
              className="underline-offset-2 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
            >
              edit chips
            </Link>
          </p>
        ) : null}
      </section>

      <PreferencesModal
        open={open}
        initialTags={preferences?.tags ?? []}
        isFirstTime={isFirstTime}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
