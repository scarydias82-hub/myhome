'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Before',
  afterLabel = 'After',
  className,
}: BeforeAfterSliderProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  function update(clientX: number) {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = ((clientX - r.left) / r.width) * 100;
    setPos(Math.max(0, Math.min(100, next)));
  }

  return (
    <div
      ref={wrap}
      className={cn(
        'relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-ink/[0.06] bg-cream select-none',
        className,
      )}
      onMouseMove={(e) => dragging && update(e.clientX)}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
      onTouchMove={(e) => update(e.touches[0]?.clientX ?? 0)}
    >
      <Image
        src={afterUrl}
        alt={afterLabel}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 80vw"
        unoptimized
        priority
      />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <div className="relative h-full" style={{ width: `${(100 / pos) * 100}%` }}>
          <Image
            src={beforeUrl}
            alt={beforeLabel}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 80vw"
            unoptimized
          />
        </div>
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded bg-ink/80 px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-paper">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded bg-clay/90 px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-paper">
        {afterLabel}
      </span>

      <div
        className="absolute inset-y-0 w-[2px] bg-paper shadow-soft"
        style={{ left: `calc(${pos}% - 1px)` }}
      >
        <button
          type="button"
          aria-label="Drag to compare"
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onTouchStart={() => setDragging(true)}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 grid h-10 w-10 place-items-center rounded-full border border-ink/10 bg-paper shadow-soft cursor-ew-resize"
        >
          <span className="font-mono text-meta uppercase tracking-eyebrow text-ink">↔</span>
        </button>
      </div>
    </div>
  );
}
