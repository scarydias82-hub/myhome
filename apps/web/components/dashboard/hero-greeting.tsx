'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PreferencesModal } from '@/components/dashboard/preferences-modal';

// Hero greeting — compressed vs the previous version. On mobile this
// is the FIRST screen so the greeting line + 4 quick actions need to
// fit above the fold on a typical phone (~640px viewport). Action
// destinations point to the 4 entry surfaces that lead to product
// engagement: take a photo (→ render), open/start a project, build
// a vision board, browse the catalogue.
//
// Each tile carries a contextual Unsplash photo at the top so the
// affordance reads visually before the label does — magazine-cover
// approach over abstract-glyph approach. The image strip + text
// pattern matches the trend cards + featured-products carousels
// elsewhere on the dashboard so the dashboard reads as one coherent
// editorial surface.
//
// The user's canonical taste signal (§6.11 Phase A, #153) is nested
// into the end of the welcome copy as an inline chip row + Edit pill.
// First-time users see a "Set up your taste signal →" CTA and the
// PreferencesModal auto-opens. This replaced the standalone
// PreferencesSection — keeping the surface dense on mobile and giving
// the chips the editorial framing of the greeting rather than a
// separate "system" panel.

interface UserPreferences {
  tags: string[];
  updated_at: string;
}

interface HeroGreetingProps {
  firstName: string;
  /** Canonical user prefs from `users.preferences`. `null` when the
   *  user hasn't onboarded yet — the modal auto-opens in that case. */
  preferences: UserPreferences | null;
}

// Tag label lookup removed 2026-05-27 — the dashboard hero no longer
// renders preferences as chips. The modal still maps slugs to labels
// via its own internal taxonomy.

type ActionKey = 'photo' | 'project' | 'board' | 'catalogue';

interface QuickAction {
  key: ActionKey;
  label: string;
  blurb: string;
  href: string;
  /** Unsplash CDN URL — fetched with sizing params so the image
   *  ships small. All 4 are from the regular images.unsplash.com
   *  CDN (no premium licensing). */
  imageUrl: string;
  /** Image-alt copy. Used by next/image alt + screen readers. */
  imageAlt: string;
}

// Image params: w=600 keeps the file lean for the small tile, fit=crop
// + auto=format lets the CDN pick AVIF/WebP when supported, q=80 is
// the editorial-quality sweet spot before diminishing returns.
const IMG = (id: string) =>
  `https://images.unsplash.com/${id}?w=600&h=400&fit=crop&auto=format&q=80`;

const ACTIONS: QuickAction[] = [
  {
    key: 'photo',
    label: 'Take a photo',
    blurb: 'Restyle a real room with AI',
    href: '/rooms/new',
    imageUrl: IMG('photo-1750639258774-9a714379a093'),
    imageAlt: 'Elegant living room with neutral colours and framed art',
  },
  {
    key: 'project',
    label: 'Start a project',
    blurb: 'Brief, render, shop',
    href: '/projects/new',
    imageUrl: IMG('photo-1719150006656-958724675d9d'),
    imageAlt: 'Minimal white room with a desk, chair and table lamp',
  },
  {
    key: 'board',
    label: 'Create a vision board',
    blurb: 'Save ideas you love',
    href: '/vision-boards/new',
    imageUrl: IMG('photo-1690733546551-1007bc0a3414'),
    imageAlt: 'Flatlay of pictures and scissors — a moodboard in progress',
  },
  {
    key: 'catalogue',
    label: 'Browse catalogue',
    blurb: 'AU retailers, real prices',
    href: '/catalogue',
    imageUrl: IMG('photo-1741682739943-d0209422f004'),
    imageAlt: 'Cozy reading corner with a lamp, plant and accent chair',
  },
];

function greetingFor(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HeroGreeting({ firstName, preferences }: HeroGreetingProps) {
  const [activeKey, setActiveKey] = useState<ActionKey | null>(null);
  const isFirstTime = preferences === null;
  // Modal opens automatically on first visit when prefs aren't set —
  // same auto-onboarding flow PreferencesSection used to drive.
  const [prefsOpen, setPrefsOpen] = useState<boolean>(isFirstTime);

  // Preferences display collapsed 2026-05-27 — the previous chip
  // row + "+N more" overflow + first-time CTA were taking too much
  // visual weight on the dashboard hero. Single-line "Your Aesthetic:
  // [Edit]" link is enough; the modal itself still handles set/edit/
  // first-time flow. Tags carry forward to the modal via initialTags.
  const tags = preferences?.tags ?? [];

  return (
    <section className="pt-6 pb-6 md:pt-10 md:pb-8">
      <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe md:text-[11px]">
        {greetingFor()}
      </p>
      <h1 className="mt-2 font-serif text-[24px] font-normal leading-[1.15] text-editorial-ink md:mt-3 md:text-[32px] md:leading-[1.1]">
        {firstName}, your <em className="italic">design studio</em> is ready.
      </h1>
      <p className="mt-2 max-w-2xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe md:mt-3 md:text-[14px]">
        Featured products, this week&apos;s trending picks, and your saved boards — pick a starting
        point.
      </p>

      {/* Collapsed 2026-05-27 — single "Your Aesthetic: edit" line.
          The modal still handles the full set/edit/onboarding flow,
          but the dashboard hero no longer renders tag chips inline.
          Auto-open on first visit (isFirstTime) is preserved so new
          users still get the onboarding prompt. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-5">
        <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe md:text-[11px]">
          Your aesthetic:
        </p>
        <button
          type="button"
          onClick={() => setPrefsOpen(true)}
          className="rounded-pill border border-editorial-border bg-editorial-surface px-3 py-1 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-ink transition hover:border-editorial-borderStrong md:text-[11px]"
        >
          edit →
        </button>
      </div>

      {/* 2-col on mobile so all 4 tiles land above the fold on most
          phones; 4-col on lg+ so it stays a single row on desktop.
          The cards are taller now to host the image strip + text. */}
      <ul className="mt-5 grid grid-cols-2 gap-2 md:mt-7 md:gap-3 lg:grid-cols-4">
        {ACTIONS.map((action) => {
          const active = action.key === activeKey;
          return (
            <li key={action.key}>
              <Link
                href={action.href}
                onMouseEnter={() => setActiveKey(action.key)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => setActiveKey(action.key)}
                onBlur={() => setActiveKey(null)}
                className={cn(
                  // Image-led card layout. Overflow-hidden + rounded so
                  // the image hugs the card corners. Min-height keeps
                  // tap target comfortable even when text wraps short.
                  'group flex h-full min-h-[200px] flex-col overflow-hidden rounded-2xl border bg-editorial-surface transition-colors duration-200 md:min-h-[240px]',
                  active
                    ? 'border-editorial-ink shadow-lg'
                    : 'border-editorial-border hover:border-editorial-borderStrong',
                )}
              >
                {/* Image strip — fills the top of the card. 4:3 on
                    mobile and md+ alike; the next/image fill prop
                    handles the actual scaling. Cognac glyph badge
                    sits over the image top-left so the action reads
                    even before the text. */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-editorial-cream">
                  <Image
                    src={action.imageUrl}
                    alt={action.imageAlt}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className={cn(
                      'object-cover transition-transform duration-300',
                      active ? 'scale-[1.04]' : 'scale-100',
                    )}
                    unoptimized
                  />
                  {/* Subtle bottom gradient — gives the corner of the
                      image a bit of weight that matches the rest of
                      the warm editorial palette. */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-editorial-ink/15 via-transparent to-transparent" />
                  {/* Glyph badge — same cognac circle as before, now
                      floating over the image top-left. Backdrop blur
                      keeps the glyph legible on any photo. */}
                  <span
                    className={cn(
                      'absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full font-serif text-[12px] backdrop-blur-md md:h-9 md:w-9 md:text-[13px]',
                      active
                        ? 'bg-editorial-ink/90 text-editorial-cream'
                        : 'bg-editorial-cream/85 text-editorial-cognac',
                    )}
                  >
                    <ActionGlyph k={action.key} />
                  </span>
                </div>

                {/* Text block — sits on cream, mirrors the trend
                    card / featured-product treatment elsewhere on
                    the dashboard. */}
                <div className="flex flex-1 flex-col gap-1 p-3 md:p-4">
                  <p
                    className={cn(
                      'font-serif text-[15px] leading-tight md:text-[17px]',
                      active ? 'text-editorial-ink' : 'text-editorial-ink',
                    )}
                  >
                    {action.label}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 font-dmsans text-[11px] leading-snug md:text-[12px]',
                      'text-editorial-taupe',
                    )}
                  >
                    {action.blurb}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <PreferencesModal
        open={prefsOpen}
        initialTags={tags}
        isFirstTime={isFirstTime}
        onClose={() => setPrefsOpen(false)}
      />
    </section>
  );
}

function ActionGlyph({ k }: { k: ActionKey }) {
  switch (k) {
    case 'photo':
      return <span aria-hidden>◎</span>;
    case 'project':
      return <span aria-hidden>◆</span>;
    case 'board':
      return <span aria-hidden>✦</span>;
    case 'catalogue':
      return <span aria-hidden>▤</span>;
  }
}
