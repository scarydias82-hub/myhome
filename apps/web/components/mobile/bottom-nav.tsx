'use client';

// BottomNav — sticky thumb-reachable navigation bar for mobile.
// Native-app feel: 5 tabs, raised central "Photo" CTA, safe-area
// inset for the home indicator on iOS.
//
// Hidden on md+ (desktop has the top nav). Also hidden on auth /
// public routes via the pathname check so it doesn't show on /login,
// /signup, or the marketing root.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  icon: React.ReactNode;
  // Match active state on any path starting with `match`.
  match: string;
  raised?: boolean;
}

const TABS: Tab[] = [
  {
    href: '/dashboard',
    label: 'Home',
    icon: <HomeIcon />,
    match: '/dashboard',
  },
  {
    href: '/vision-boards',
    label: 'Boards',
    icon: <BoardsIcon />,
    match: '/vision-boards',
  },
  {
    href: '/rooms/new',
    label: 'Photo',
    icon: <CameraIcon />,
    match: '/rooms',
    raised: true,
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: <ProjectsIcon />,
    match: '/projects',
  },
  {
    href: '/catalogue',
    label: 'Shop',
    icon: <CatalogueIcon />,
    match: '/catalogue',
  },
];

// Routes where BottomNav stays hidden. Auth flows + public marketing
// surfaces don't need an app nav, and would be confusing for users
// who aren't logged in.
const HIDDEN_PREFIXES = ['/login', '/signup', '/auth'];

export function BottomNav() {
  const pathname = usePathname() ?? '';

  // Root marketing page (`/`) — also hide. Don't hide on every other
  // path; checking exact equality.
  if (pathname === '/') return null;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Primary mobile navigation"
      className={cn(
        // Fixed to viewport bottom, mobile-only. md:hidden so desktop
        // retains the existing top-nav pattern.
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        // Safe-area inset for iOS home indicator. We pad the BOTTOM
        // of the nav so its content stays clear of the gesture bar.
        'pb-[env(safe-area-inset-bottom)]',
        // Backdrop — cream tinted, slight blur, top border keeps it
        // visually separated from the page content above.
        'border-t border-editorial-border bg-editorial-cream/95 backdrop-blur-md',
      )}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-2 pt-1.5">
        {TABS.map((tab) => {
          const active = pathname === tab.match || pathname.startsWith(`${tab.match}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // 56px target = comfortable thumb tap. The raised
                  // Photo tab gets a circular treatment that sits
                  // slightly above the bar for visual emphasis.
                  'group relative flex h-14 flex-col items-center justify-center gap-0.5',
                )}
              >
                {tab.raised ? (
                  <span
                    className={cn(
                      // Raised photo glyph — cognac filled circle,
                      // sits above the nav line. 48px so the tap
                      // target is unmistakable.
                      'absolute -top-3 grid h-12 w-12 place-items-center rounded-full shadow-lg transition-transform',
                      active
                        ? 'bg-editorial-ink text-editorial-cream scale-105'
                        : 'bg-editorial-cognac text-editorial-cream',
                    )}
                  >
                    {tab.icon}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'transition-colors',
                      active ? 'text-editorial-ink' : 'text-editorial-taupe',
                    )}
                  >
                    {tab.icon}
                  </span>
                )}
                <span
                  className={cn(
                    'font-dmmono text-[10px] uppercase tracking-[0.08em]',
                    tab.raised ? 'mt-7' : 'mt-0',
                    active ? 'font-medium text-editorial-ink' : 'text-editorial-taupe',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// --- Icons (inline SVGs, sized 22px, currentColor) ---

function HomeIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function BoardsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 8.5h3l1.5-2h5L16 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18v-8A1.5 1.5 0 0 1 5 8.5Z" />
      <circle cx="12" cy="13.5" r="3" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.5 2h9.5A1.5 1.5 0 0 1 21 9.5v9A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-11Z" />
    </svg>
  );
}

function CatalogueIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 7h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3L5 7Z" />
      <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
    </svg>
  );
}
