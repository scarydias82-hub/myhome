'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

export interface ItemCardData {
  id: string;
  category: string;
  name: string;
  retailer: string;
  priceAud: number;
  thumbnailUrl?: string;
  alternativesCount?: number;
}

interface ItemCardProps extends Omit<React.HTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  data: ItemCardData;
  active?: boolean;
  onSelect?: (id: string) => void;
}

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function ItemCard({ data, active, onSelect, className, ...props }: ItemCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(data.id)}
      className={cn(
        'group flex w-full items-stretch gap-4 rounded-md p-3 text-left transition-all duration-200 ease-editorial',
        'hover:-translate-x-1',
        active && 'bg-paper-warm rounded-md',
        className,
      )}
      aria-pressed={active}
      {...props}
    >
      <div className="relative h-[76px] w-[76px] flex-shrink-0 overflow-hidden rounded-sm bg-paper-warm">
        {data.thumbnailUrl ? (
          <Image
            src={data.thumbnailUrl}
            alt=""
            fill
            sizes="76px"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-paper-deep to-ink/40" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {data.category}
        </p>
        <h4 className="mt-1 truncate font-display text-base font-normal text-ink">{data.name}</h4>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-[12px] text-ink-soft">{data.retailer}</p>
          <p className="font-mono text-price font-medium text-ink">{aud.format(data.priceAud)}</p>
        </div>
        {data.alternativesCount ? (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-clay">
            + {data.alternativesCount} alternatives
          </p>
        ) : null}
      </div>
    </button>
  );
}
