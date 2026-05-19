'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pill } from '@/components/saltbush/pill';
import { cn } from '@/lib/utils';

interface ShortlistItem {
  id: string;
  kind: 'render' | 'staged' | 'product';
  render_id: string | null;
  staged_image_id: string | null;
  product_id: string | null;
  created_at: string;
}

interface ProductSummary {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
  dimensions: Record<string, unknown> | null;
}

interface ShortlistRowProps {
  item: ShortlistItem;
  projectId: string;
  renderUrl: string | null;
  stagedUrl: string | null;
  product: ProductSummary | null;
  locked?: boolean;
}

export function ShortlistRow({
  item,
  projectId,
  renderUrl,
  stagedUrl,
  product,
  locked,
}: ShortlistRowProps) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await fetch(`/api/projects/${projectId}/shortlist?itemId=${item.id}`, {
        method: 'DELETE',
      });
      router.refresh();
    } catch {
      setRemoving(false);
    }
  }

  const imageUrl =
    item.kind === 'render' ? renderUrl : item.kind === 'staged' ? stagedUrl : product?.image_url ?? null;
  const link =
    item.kind === 'render' && item.render_id
      ? `/renders/${item.render_id}`
      : item.kind === 'product' && product
        ? product.affiliate_url ?? product.product_url
        : null;
  const linkIsExternal = item.kind === 'product';

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
      <div className="relative aspect-[4/3] w-full bg-paper-warm bg-grain">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.kind}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="grid h-full place-items-center">
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              No preview
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3 p-4">
        <div>
          <Pill tone={item.kind === 'render' ? 'cream' : item.kind === 'staged' ? 'clay' : 'olive'}>
            {item.kind}
          </Pill>
          {product ? (
            <>
              <p className="mt-3 line-clamp-2 font-display text-h4 text-ink">{product.name}</p>
              <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                {product.retailer} · {product.category}
              </p>
              <p className="mt-1 font-display text-h4 text-ink">
                {product.price_aud != null
                  ? `$${Math.round(product.price_aud).toLocaleString('en-AU')}`
                  : 'POA'}
              </p>
            </>
          ) : null}
          {item.kind === 'render' && !product ? (
            <p className="mt-3 font-display text-h4 text-ink">Restyle proposal</p>
          ) : null}
          {item.kind === 'staged' && !product ? (
            <p className="mt-3 font-display text-h4 text-ink">In-room staging</p>
          ) : null}
          <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Added {new Date(item.created_at).toLocaleDateString('en-AU')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {link ? (
            <Link
              href={link}
              target={linkIsExternal ? '_blank' : undefined}
              rel={linkIsExternal ? 'noopener noreferrer sponsored' : undefined}
              className="rounded-pill bg-ink px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-paper hover:opacity-90"
            >
              {item.kind === 'render' ? 'Open render →' : 'View at retailer ↗'}
            </Link>
          ) : null}
          {!locked ? (
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className={cn(
                'rounded-pill border border-ink/15 bg-cream px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-destructive/40 hover:text-destructive',
                removing && 'opacity-50',
              )}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
