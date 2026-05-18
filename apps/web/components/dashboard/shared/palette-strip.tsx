import { cn } from '@/lib/utils';

interface PaletteStripProps {
  colors: string[];
  className?: string;
  ariaLabel?: string;
}

// Compact swatch row used on project cards and trend cards. Distinct
// from the Saltbush PaletteStrip — tighter, smaller, no labels.
export function PaletteStrip({ colors, className, ariaLabel }: PaletteStripProps) {
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? `Palette: ${colors.join(', ')}`}
      className={cn('flex gap-1', className)}
    >
      {colors.map((hex, i) => (
        <span
          key={`${hex}-${i}`}
          aria-hidden
          className="h-3 w-6 rounded-sm border border-editorial-border"
          style={{ background: hex }}
        />
      ))}
    </div>
  );
}
