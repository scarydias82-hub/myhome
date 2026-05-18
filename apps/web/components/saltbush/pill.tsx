import { cn } from '@/lib/utils';

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'cream' | 'ink' | 'clay' | 'olive';
  size?: 'sm' | 'md';
  withDot?: boolean;
  dotTone?: 'clay' | 'olive' | 'gold';
}

const toneClass = {
  cream: 'bg-cream text-ink shadow-pop',
  ink: 'bg-ink text-cream',
  clay: 'bg-clay text-cream',
  olive: 'bg-olive text-cream',
} as const;

const sizeClass = {
  sm: 'h-7 px-3 text-[11px]',
  md: 'h-9 px-4 text-[13px]',
} as const;

const dotClass = {
  clay: 'bg-clay',
  olive: 'bg-olive',
  gold: 'bg-gold',
} as const;

export function Pill({
  className,
  tone = 'cream',
  size = 'sm',
  withDot,
  dotTone = 'clay',
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-pill font-medium',
        toneClass[tone],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {withDot ? (
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dotClass[dotTone])} />
      ) : null}
      {children}
    </span>
  );
}
