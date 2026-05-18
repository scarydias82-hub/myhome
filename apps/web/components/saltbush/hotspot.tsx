'use client';

import { cn } from '@/lib/utils';

interface HotspotProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Position as percentages from the top-left of the parent (which must be `relative`). */
  position: { top: string; left: string };
  label: string;
}

/**
 * Overlay dot used to label items on a rendered image. Place inside a
 * `relative` container. `label` is the accessible name for the item.
 */
export function Hotspot({ active, position, label, className, ...props }: HotspotProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      style={{ top: position.top, left: position.left }}
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2',
        'flex h-7 w-7 items-center justify-center rounded-full border-2 border-clay',
        'transition-transform duration-200 ease-editorial hover:scale-110',
        active ? 'bg-clay' : 'bg-cream',
        active && 'shadow-pop',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'block h-2 w-2 rounded-full',
          active ? 'bg-cream' : 'bg-clay',
          active && 'animate-pulse',
        )}
      />
    </button>
  );
}
