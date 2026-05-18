'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface HeroGreetingProps {
  firstName: string;
}

type ActionKey = 'visualise' | 'project' | 'trends' | 'boards';

interface QuickAction {
  key: ActionKey;
  label: string;
  blurb: string;
  href: string;
}

const ACTIONS: QuickAction[] = [
  {
    key: 'visualise',
    label: 'Visualise a product',
    blurb: 'Place a real SKU in your room photo',
    href: '/catalogue',
  },
  {
    key: 'project',
    label: 'Open a project',
    blurb: 'Continue an existing design',
    href: '/projects',
  },
  {
    key: 'trends',
    label: 'Explore trends',
    blurb: '2026 palettes, AI-rendered',
    href: '/dashboard#trends',
  },
  {
    key: 'boards',
    label: 'Browse your boards',
    blurb: 'Pinterest inspiration synced',
    href: '/dashboard#pinterest',
  },
];

function greetingFor(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HeroGreeting({ firstName }: HeroGreetingProps) {
  const [activeKey, setActiveKey] = useState<ActionKey>('visualise');
  return (
    <section className="pt-12 pb-10">
      <p className="font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
        {greetingFor()}
      </p>
      <h1 className="mt-3 font-serif text-[32px] font-normal leading-[1.1] text-editorial-ink">
        {firstName}, your <em className="italic">design studio</em> is ready.
      </h1>
      <p className="mt-3 max-w-2xl font-dmsans text-[14px] leading-relaxed text-editorial-taupe">
        From inspiration to a fully shopped lounge room — in minutes. Pick a starting point:
        your boards, an open project, the 2026 trend wall, or the Australian catalogue.
      </p>

      <ul className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ACTIONS.map((action) => {
          const active = action.key === activeKey;
          return (
            <li key={action.key}>
              <Link
                href={action.href}
                onMouseEnter={() => setActiveKey(action.key)}
                onFocus={() => setActiveKey(action.key)}
                className={cn(
                  'group block h-full rounded-2xl border p-5 transition-colors duration-200',
                  active
                    ? 'border-editorial-ink bg-editorial-ink text-editorial-cream'
                    : 'border-editorial-border bg-editorial-surface text-editorial-ink hover:border-editorial-borderStrong',
                )}
              >
                <div
                  className={cn(
                    'mb-4 grid h-9 w-9 place-items-center rounded-full font-serif text-[13px]',
                    active ? 'bg-editorial-cognac text-editorial-ink' : 'bg-editorial-cream text-editorial-cognac',
                  )}
                >
                  <ActionGlyph k={action.key} />
                </div>
                <p
                  className={cn(
                    'font-serif text-[17px] leading-tight',
                    active ? 'text-editorial-cream' : 'text-editorial-ink',
                  )}
                >
                  {action.label}
                </p>
                <p
                  className={cn(
                    'mt-1.5 font-dmsans text-[12px] leading-relaxed',
                    active ? 'text-editorial-cream/70' : 'text-editorial-taupe',
                  )}
                >
                  {action.blurb}
                </p>
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
    case 'visualise':
      return <span aria-hidden>◎</span>;
    case 'project':
      return <span aria-hidden>◆</span>;
    case 'trends':
      return <span aria-hidden>✦</span>;
    case 'boards':
      return <span aria-hidden>▤</span>;
  }
}
