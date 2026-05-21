'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Hero greeting — compressed vs the previous version. On mobile this
// is the FIRST screen so the greeting line + 4 quick actions need to
// fit above the fold on a typical phone (~640px viewport). Action
// destinations point to the 4 entry surfaces that lead to product
// engagement: take a photo (→ render), open/start a project, build
// a vision board (new Phase 2 surface), browse the catalogue.

interface HeroGreetingProps {
  firstName: string;
}

type ActionKey = 'photo' | 'project' | 'board' | 'catalogue';

interface QuickAction {
  key: ActionKey;
  label: string;
  blurb: string;
  href: string;
}

const ACTIONS: QuickAction[] = [
  {
    key: 'photo',
    label: 'Take a photo',
    blurb: 'Restyle a real room with AI',
    href: '/rooms/new',
  },
  {
    key: 'project',
    label: 'Start a project',
    blurb: 'Brief, render, shop',
    href: '/projects/new',
  },
  {
    key: 'board',
    label: 'Create a vision board',
    blurb: 'Save ideas you love',
    href: '/vision-boards/new',
  },
  {
    key: 'catalogue',
    label: 'Browse catalogue',
    blurb: 'AU retailers, real prices',
    href: '/catalogue',
  },
];

function greetingFor(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HeroGreeting({ firstName }: HeroGreetingProps) {
  const [activeKey, setActiveKey] = useState<ActionKey | null>(null);
  return (
    <section className="pt-6 pb-6 md:pt-10 md:pb-8">
      <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe md:text-[11px]">
        {greetingFor()}
      </p>
      <h1 className="mt-2 font-serif text-[24px] font-normal leading-[1.15] text-editorial-ink md:mt-3 md:text-[32px] md:leading-[1.1]">
        {firstName}, your <em className="italic">design studio</em> is ready.
      </h1>
      <p className="mt-2 max-w-2xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe md:mt-3 md:text-[14px]">
        Featured products, this week's trending picks, and your saved boards — pick a starting
        point.
      </p>

      {/* 2-col on mobile so all 4 tiles land above the fold on most
          phones; 4-col on lg+ so it stays a single row on desktop.
          gap-2 on mobile, gap-3 on md+, to keep touch targets close
          together without crowding. */}
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
                  // Tap target: full card, min-height ensures ≥ 44px
                  // even when text wraps to a single line on a narrow
                  // screen. p-4 on mobile vs p-5 on md keeps the
                  // density right.
                  'group flex h-full min-h-[112px] flex-col justify-between rounded-2xl border p-4 transition-colors duration-200 md:min-h-[140px] md:p-5',
                  active
                    ? 'border-editorial-ink bg-editorial-ink text-editorial-cream'
                    : 'border-editorial-border bg-editorial-surface text-editorial-ink hover:border-editorial-borderStrong',
                )}
              >
                <div
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-full font-serif text-[12px] md:h-9 md:w-9 md:text-[13px]',
                    active
                      ? 'bg-editorial-cognac text-editorial-ink'
                      : 'bg-editorial-cream text-editorial-cognac',
                  )}
                >
                  <ActionGlyph k={action.key} />
                </div>
                <div className="mt-3 md:mt-4">
                  <p
                    className={cn(
                      'font-serif text-[15px] leading-tight md:text-[17px]',
                      active ? 'text-editorial-cream' : 'text-editorial-ink',
                    )}
                  >
                    {action.label}
                  </p>
                  <p
                    className={cn(
                      'mt-1 font-dmsans text-[11px] leading-snug md:mt-1.5 md:text-[12px]',
                      active ? 'text-editorial-cream/70' : 'text-editorial-taupe',
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
