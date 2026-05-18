import Link from 'next/link';

interface TopNavProps {
  initials: string;
  fullName: string;
}

// Sticky 52px top nav with backdrop blur. Logo is "my" italic + "home"
// regular, both Playfair Display. BETA chip. Centre nav for major IA.
export function TopNav({ initials, fullName }: TopNavProps) {
  return (
    <header className="sticky top-0 z-40 h-[52px] border-b border-editorial-border bg-editorial-cream/85 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2"
          aria-label="myMaison — your personal design studio"
        >
          {/*
            Brand wordmark per myMaison guidelines:
              - "my" in italic, warm taupe (#8B7355), weight 400
              - "Maison" in roman, espresso (#2C1F14), weight 500
            The case break + colour shift between the two halves is the
            brand's signature gesture.
          */}
          <span className="font-serif text-[20px] leading-none">
            <span className="italic font-normal text-editorial-taupe">my</span>
            <span className="font-medium text-editorial-ink">Maison</span>
          </span>
          <span className="rounded-full bg-editorial-cognac/15 px-1.5 py-0.5 font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-cognac">
            Beta
          </span>
        </Link>

        <nav className="hidden gap-7 md:flex">
          <NavLink href="/dashboard">Discover</NavLink>
          <NavLink href="/projects">Projects</NavLink>
          <NavLink href="/catalogue">Catalogue</NavLink>
          <NavLink href="/retailers">Retailers</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          <div
            aria-label={`Signed in as ${fullName}`}
            className="grid h-8 w-8 place-items-center rounded-full border border-editorial-borderStrong bg-editorial-surface font-dmmono text-[11px] font-medium uppercase text-editorial-ink"
          >
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-dmsans text-[13px] font-medium text-editorial-ink/80 transition hover:text-editorial-ink"
    >
      {children}
    </Link>
  );
}
