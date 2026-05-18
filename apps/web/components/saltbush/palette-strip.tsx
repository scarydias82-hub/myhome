import { cn } from '@/lib/utils';

interface PaletteStripProps {
  colors: string[];
  label?: string;
  className?: string;
}

export function PaletteStrip({ colors, label = 'Detected palette', className }: PaletteStripProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 rounded-pill bg-paper px-5 py-3 shadow-pop',
        className,
      )}
      role="group"
      aria-label={label}
    >
      <div className="flex items-center gap-2">
        {colors.map((c, i) => (
          <span
            key={`${c}-${i}`}
            aria-hidden
            className="block h-[22px] w-[22px] rounded-full ring-1 ring-ink/10"
            style={{ background: c }}
          />
        ))}
      </div>
      {label ? (
        <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {label}
        </span>
      ) : null}
    </div>
  );
}
