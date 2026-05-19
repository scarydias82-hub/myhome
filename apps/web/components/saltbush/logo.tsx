import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Show the Beta chip next to the wordmark. Defaults to true. */
  showBeta?: boolean;
}

// myMaison wordmark.
//
// This component used to render "saltbush." with a clay dot — the
// legacy brand. Now it renders the editorial wordmark: `my` italic
// taupe + `Maison` roman espresso + a small cognac Beta chip. The file
// keeps the `components/saltbush/` path only because every legacy
// surface imports from here — the path is historical, the visual is
// current.
const sizes: Record<'sm' | 'md' | 'lg', { type: string; beta: string }> = {
  sm: { type: 'text-[20px]', beta: 'text-[8px]' },
  md: { type: 'text-[24px]', beta: 'text-[9px]' },
  lg: { type: 'text-[34px]', beta: 'text-[11px]' },
};

export function Logo({
  href = '/',
  size = 'md',
  className,
  showBeta = true,
}: LogoProps) {
  const s = sizes[size];
  const inner = (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className={cn('font-serif leading-none tracking-tight', s.type)}>
        <span className="italic font-normal text-editorial-taupe">my</span>
        <span className="font-medium text-editorial-ink">Maison</span>
      </span>
      {showBeta ? (
        <span
          className={cn(
            'rounded-full bg-editorial-cognac/15 px-1.5 py-0.5 font-dmmono uppercase tracking-[0.14em] text-editorial-cognac',
            s.beta,
          )}
        >
          Beta
        </span>
      ) : null}
    </span>
  );

  if (!href) return inner;
  return (
    <Link
      href={href}
      aria-label="myMaison — home"
      className="transition-opacity hover:opacity-80"
    >
      {inner}
    </Link>
  );
}
