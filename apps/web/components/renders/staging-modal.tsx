'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { ShortlistButton } from '@/components/projects/shortlist-button';

interface StagingModalProps {
  open: boolean;
  onClose: () => void;
  renderId: string;
  itemIndex: number;
  projectId?: string | null;
  product: {
    productId: string;
    name: string;
    retailer: string;
    imageUrl: string;
    productUrl: string;
    affiliateUrl: string | null;
  };
}

export function StagingModal({
  open,
  onClose,
  renderId,
  itemIndex,
  projectId,
  product,
}: StagingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [stagedImageId, setStagedImageId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setResult(null);

    let cancelled = false;
    fetch('/api/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ renderId, itemIndex, productId: product.productId }),
    })
      .then((res) => res.json())
      .then((json: { imageUrl?: string; stagedImageId?: string; error?: string }) => {
        if (cancelled) return;
        if (json.imageUrl) {
          setResult(json.imageUrl);
          setStagedImageId(json.stagedImageId ?? null);
        } else {
          setError(json.error ?? 'Staging failed. Try again.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Network error.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, renderId, itemIndex, product.productId]);

  if (!open) return null;

  const buyHref = product.affiliateUrl ?? product.productUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4"
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-cream">
        <div className="flex items-center justify-between border-b border-ink/[0.06] p-5">
          <div>
            <Eyebrow>In your room</Eyebrow>
            <DisplayHeading level={3} className="mt-1">
              {product.name}
            </DisplayHeading>
            <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              {product.retailer}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="relative aspect-[4/3] w-full bg-paper-warm bg-grain">
          {loading ? (
            <div className="absolute inset-0 grid place-items-center">
              <div>
                <div className="mx-auto h-3 w-40 overflow-hidden rounded-full bg-ink/10">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
                </div>
                <p className="mt-4 text-center font-display text-h4 text-ink">
                  Placing in your room…
                </p>
                <p className="mt-1 text-center font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  ~20s · Flux inpaint
                </p>
              </div>
            </div>
          ) : result ? (
            <Image
              src={result}
              alt={`${product.name} placed in your room`}
              fill
              sizes="(max-width: 768px) 100vw, 80vw"
              className="object-cover"
              unoptimized
            />
          ) : error ? (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <p className="font-display text-h3 text-ink">Couldn't place it.</p>
                <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-soft">{error}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] p-5">
          <p className="max-w-sm text-[13px] text-ink-soft">
            AI composite. Final fit, scale and finish may vary — confirm with retailer dimensions
            before buying.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {stagedImageId ? (
              <ShortlistButton
                projectId={projectId ?? null}
                kind="staged"
                sourceId={stagedImageId}
                label="Add to review"
              />
            ) : null}
            <a
              href={buyHref}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="rounded-pill bg-ink px-5 py-2 font-mono text-meta uppercase tracking-eyebrow text-paper hover:bg-ink-soft"
            >
              View at {product.retailer} ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
