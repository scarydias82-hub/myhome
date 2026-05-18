interface CompatBarProps {
  value: number; // 0..100
  label?: string;
}

// Compatibility bar shown on AR product cards. Animates width on mount
// (see brief: 0.6s ease). Always 100% accessible via role=progressbar.
export function CompatBar({ value, label = 'Compatibility' }: CompatBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <span className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-taupe">
        {label}
      </span>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1 flex-1 overflow-hidden rounded-full bg-editorial-border"
      >
        <div
          className="absolute inset-y-0 left-0 bg-editorial-cognac transition-[width] duration-[600ms] ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-dmmono text-[10px] tabular-nums text-editorial-ink">{clamped}%</span>
    </div>
  );
}
