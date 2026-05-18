import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'text-xl',
  md: 'text-[28px] leading-none',
  lg: 'text-4xl',
};

export function Logo({ href = '/', size = 'md', className }: LogoProps) {
  const inner = (
    <span
      className={cn(
        'inline-flex items-baseline font-display italic font-light text-ink tracking-tight',
        sizes[size],
        className,
      )}
    >
      saltbush
      <span aria-hidden className="ml-px not-italic font-light text-clay">
        .
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} aria-label="saltbush — home" className="transition-opacity hover:opacity-80">
      {inner}
    </Link>
  );
}
