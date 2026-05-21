'use client';

// BoardImageUpload — upload an inspiration image (Pinterest pin,
// IG screenshot, random product photo) → Claude vision identifies
// the primary product → we match against our catalogue → user can
// add any of the matches to the board.
//
// Mobile-first: full-width on small, centered card with file picker
// + camera fallback. After upload we show identification + 6 match
// cards in a 2-column grid. Each match has an "Add to board" button.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/saltbush/pill';
import { cn } from '@/lib/utils';

interface Identification {
  primary_subject: string;
  category: string;
  style_descriptors: string[];
  materials: string[];
  colour_family: string;
  confidence: 'high' | 'medium' | 'low';
}

interface MatchedProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  match_score: number;
}

interface UploadResult {
  itemId: string;
  storageKey: string;
  identification: Identification;
  matches: MatchedProduct[];
}

export function BoardImageUpload({ boardId }: { boardId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setResult(null);

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Image is too large. Keep it under 4 MB.');
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await fetch(`/api/vision-boards/${boardId}/upload`, {
        method: 'POST',
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as
        | UploadResult
        | { error?: string };
      if (!res.ok || !('itemId' in json)) {
        setError(('error' in json && json.error) || 'Upload failed.');
        return;
      }
      setResult(json);
      router.refresh(); // re-render the board grid to show the new image item
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setUploading(false);
    }
  }

  async function addToBoard(productId: string) {
    setAdding((s) => ({ ...s, [productId]: true }));
    try {
      const res = await fetch(`/api/vision-boards/${boardId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId }),
      });
      if (res.ok) {
        setAdded((s) => ({ ...s, [productId]: true }));
        router.refresh();
      }
    } catch {
      // Silent — the result strip stays; user can retry
    } finally {
      setAdding((s) => ({ ...s, [productId]: false }));
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setAdded({});
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <section className="rounded-2xl border border-ink/[0.06] bg-cream p-5 md:p-6">
      <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Inspiration → catalogue match
          </p>
          <p className="mt-1 font-display text-h4 leading-tight text-ink md:text-[20px]">
            Upload a picture you love
          </p>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            A Pinterest pin, an Instagram screenshot, a magazine photo, anything. Claude
            identifies what&rsquo;s in it and finds the closest match in our AU catalogue.
          </p>
        </div>
        {!result && !uploading ? (
          <Button
            type="button"
            variant="cta"
            onClick={() => fileInput.current?.click()}
          >
            ✦ Choose image
          </Button>
        ) : null}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {uploading ? (
        <div className="mt-5 flex items-start gap-4 rounded-xl border border-clay/40 bg-clay/[0.06] p-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-clay/40 bg-cream">
            <span aria-hidden className="animate-pulse text-clay text-[18px]">◎</span>
          </div>
          <div>
            <p className="font-display text-h4 leading-tight text-ink md:text-[18px]">
              Reading the image…
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
              Claude is identifying the product, then matching it against our catalogue. About
              5–10 seconds.
            </p>
            <div className="mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-cream">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-5">
          {/* Identification summary */}
          <div className="rounded-xl border border-clay/30 bg-clay/[0.04] p-4">
            <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
              Claude sees · {result.identification.confidence} confidence
            </p>
            <p className="mt-1 font-display text-h4 leading-tight text-ink md:text-[18px]">
              {capitalise(result.identification.primary_subject)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="clay" size="sm">
                {result.identification.category}
              </Pill>
              {result.identification.style_descriptors.slice(0, 3).map((s) => (
                <Pill key={s} tone="cream" size="sm">
                  {s}
                </Pill>
              ))}
              {result.identification.materials.slice(0, 3).map((m) => (
                <Pill key={m} tone="cream" size="sm">
                  {m}
                </Pill>
              ))}
            </div>
          </div>

          {/* Matches grid */}
          {result.matches.length === 0 ? (
            <p className="rounded-lg border border-ink/[0.06] bg-paper-warm bg-grain p-4 text-[13px] text-ink-soft md:text-[14px]">
              No close matches in our catalogue yet. The image is saved to your board so you
              can come back to it later.
            </p>
          ) : (
            <div>
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Closest matches · tap to add any to your board
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.matches.map((m) => {
                  const isAdding = adding[m.id];
                  const isAdded = added[m.id];
                  return (
                    <li key={m.id}>
                      <article
                        className={cn(
                          'flex h-full flex-col overflow-hidden rounded-xl border bg-cream transition',
                          isAdded
                            ? 'border-olive/60 ring-1 ring-olive/30'
                            : 'border-ink/[0.06] hover:border-ink/20',
                        )}
                      >
                        <div className="relative aspect-square w-full bg-paper-warm bg-grain">
                          <Image
                            src={m.image_url}
                            alt={m.name}
                            fill
                            sizes="(max-width: 768px) 50vw, 25vw"
                            className="object-cover"
                            unoptimized
                          />
                          <span className="absolute right-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-paper">
                            {Math.round(m.match_score * 100)}% match
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col gap-2 p-3">
                          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                            {m.retailer}
                          </p>
                          <p className="line-clamp-2 font-display text-[14px] leading-tight text-ink">
                            {m.name}
                          </p>
                          <p className="font-display text-[16px] text-ink">
                            {m.price_aud != null
                              ? `$${Math.round(m.price_aud).toLocaleString('en-AU')}`
                              : 'POA'}
                          </p>
                          <button
                            type="button"
                            onClick={() => addToBoard(m.id)}
                            disabled={isAdding || isAdded}
                            className={cn(
                              'mt-auto inline-flex w-full items-center justify-center gap-1 rounded-full px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
                              isAdded
                                ? 'border border-olive/60 bg-olive/10 text-olive'
                                : 'border border-clay/40 bg-clay/10 text-clay hover:bg-clay/20',
                            )}
                          >
                            {isAdding ? '…' : isAdded ? '✓ Added' : '+ Add to board'}
                          </button>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Reset CTA */}
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              Upload another
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
