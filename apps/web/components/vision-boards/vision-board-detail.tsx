'use client';

// VisionBoardDetail — interactive client component for /vision-boards/[id].
// Renders all items in the board (palette swatches, trend cards,
// product cards, notes), each with a remove button. Items optimistically
// disappear from the UI; the API call fires in the background.
//
// Mobile-first layout: single-column on mobile, 2-col on md, 3-col
// on lg+. Items aren't grouped by type — they sit in insertion order
// so the user sees the board as the moodboard they built, not as
// four type-buckets.
//
// Convert-to-project CTA is teaser-only here; Phase 3 (#136) wires
// it to the brief synthesiser. Add-note input is included so users
// can attach free-text inspiration directly from the detail view.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/saltbush/pill';
import { cn } from '@/lib/utils';

interface ItemPayload {
  caption?: string;
  body?: string;
  [k: string]: unknown;
}

export interface BoardItem {
  id: string;
  itemType: 'palette' | 'trend' | 'product' | 'note';
  paletteId: string | null;
  trendCardId: string | null;
  productId: string | null;
  payload: ItemPayload;
}

export interface PaletteRef {
  id: string;
  name: string;
  vibe: string;
  swatchHexes: string[];
  trendSource: string;
}

export interface TrendRef {
  id: string;
  paletteId: string;
  paletteName: string;
  roomType: string;
  headline: string;
  imageUrl: string;
}

export interface ProductRef {
  id: string;
  name: string;
  retailer: string;
  priceAud: number | null;
  imageUrl: string;
  productUrl: string;
  category: string;
}

interface VisionBoardDetailProps {
  boardId: string;
  items: BoardItem[];
  palettes: PaletteRef[];
  trendCards: TrendRef[];
  products: ProductRef[];
}

export function VisionBoardDetail({
  boardId,
  items: initialItems,
  palettes,
  trendCards,
  products,
}: VisionBoardDetailProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const palettesById = new Map(palettes.map((p) => [p.id, p]));
  const trendsById = new Map(trendCards.map((t) => [t.id, t]));
  const productsById = new Map(products.map((p) => [p.id, p]));

  async function removeItem(itemId: string) {
    setPendingRemove(itemId);
    // Optimistic update — drop locally before the network round-trip.
    const next = items.filter((i) => i.id !== itemId);
    setItems(next);
    try {
      const res = await fetch(`/api/vision-boards/${boardId}/items/${itemId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        // Rollback on failure — put the item back so the user
        // notices we didn't actually delete it.
        setItems(initialItems);
      }
    } catch {
      setItems(initialItems);
    } finally {
      setPendingRemove(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {/* Convert-to-project — Phase 3 teaser. Disabled until the board
          has enough content (≥ 3 items) so the conversion feeds the
          brief synthesiser with real signal rather than a sparse
          payload. */}
      <ConvertToProjectCTA itemCount={items.length} boardId={boardId} />

      {items.length === 0 ? (
        <EmptyBoardState boardId={boardId} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              {item.itemType === 'palette' && item.paletteId ? (
                <PaletteCard
                  palette={palettesById.get(item.paletteId) ?? null}
                  caption={item.payload.caption}
                  onRemove={() => removeItem(item.id)}
                  pending={pendingRemove === item.id}
                />
              ) : item.itemType === 'trend' && item.trendCardId ? (
                <TrendCard
                  trend={trendsById.get(item.trendCardId) ?? null}
                  caption={item.payload.caption}
                  onRemove={() => removeItem(item.id)}
                  pending={pendingRemove === item.id}
                />
              ) : item.itemType === 'product' && item.productId ? (
                <ProductCard
                  product={productsById.get(item.productId) ?? null}
                  caption={item.payload.caption}
                  onRemove={() => removeItem(item.id)}
                  pending={pendingRemove === item.id}
                />
              ) : item.itemType === 'note' ? (
                <NoteCard
                  body={typeof item.payload.body === 'string' ? item.payload.body : ''}
                  onRemove={() => removeItem(item.id)}
                  pending={pendingRemove === item.id}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-ink/15 p-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  Unknown item
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddNoteForm boardId={boardId} onAdded={() => router.refresh()} />
    </div>
  );
}

function ConvertToProjectCTA({ itemCount, boardId }: { itemCount: number; boardId: string }) {
  const ready = itemCount >= 3;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-5 md:flex-row md:items-center md:justify-between md:p-6',
        ready
          ? 'border-clay/40 bg-clay/5'
          : 'border-ink/[0.06] bg-paper-warm bg-grain',
      )}
    >
      <div>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
          {ready ? 'Ready when you are' : 'Save 3 items to unlock'}
        </p>
        <p className="mt-1 font-display text-h4 text-ink">
          Turn this board into a project
        </p>
        <p className="mt-1 max-w-xl text-[13px] text-ink-soft md:text-[14px]">
          {ready
            ? "We'll seed the brief with the palettes, trends, and products you've saved, then walk you through uploading a room photo."
            : 'Add a few more palettes, trends, or products — three is usually enough for us to write a tight brief.'}
        </p>
      </div>
      {/* Phase 3 (#136) wires this to /rooms/new?visionBoardId=... For
          now it links to /projects/new with a board-id query param so
          we can pick it up server-side later without changing the URL
          shape twice. */}
      {ready ? (
        <Link href={`/projects/new?visionBoardId=${boardId}`}>
          <Button variant="cta">✦ Convert to project</Button>
        </Link>
      ) : (
        <Button variant="secondary" disabled>
          ✦ Convert to project
        </Button>
      )}
    </div>
  );
}

function EmptyBoardState({ boardId: _boardId }: { boardId: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-warm bg-grain p-8 text-center md:p-12">
      <p className="font-display text-h3 text-ink">Empty board.</p>
      <p className="mt-3 max-w-xl mx-auto text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
        Head over to the catalogue, a trend card on the dashboard, or any palette — tap{' '}
        <strong>✦ Add to board</strong> to save it here.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/catalogue">
          <Button variant="cta">Browse catalogue</Button>
        </Link>
        <Link href="/dashboard#palettes">
          <Button variant="secondary">View palettes</Button>
        </Link>
      </div>
    </div>
  );
}

function PaletteCard({
  palette,
  caption,
  onRemove,
  pending,
}: {
  palette: PaletteRef | null;
  caption?: string;
  onRemove: () => void;
  pending: boolean;
}) {
  if (!palette) return <MissingItemCard label="Palette" onRemove={onRemove} pending={pending} />;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-ink/[0.06] bg-cream">
      <div className="grid h-32 grid-cols-5">
        {palette.swatchHexes.slice(0, 5).map((hex, i) => (
          <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Pill tone="clay" size="sm">
          Palette
        </Pill>
        <p className="font-display text-[17px] leading-tight text-ink">{palette.name}</p>
        <p className="line-clamp-2 text-[12px] leading-relaxed text-ink-soft">{palette.vibe}</p>
        {caption ? (
          <p className="mt-1 line-clamp-2 italic text-[12px] text-ink-soft">&ldquo;{caption}&rdquo;</p>
        ) : null}
        <RemoveButton onRemove={onRemove} pending={pending} />
      </div>
    </article>
  );
}

function TrendCard({
  trend,
  caption,
  onRemove,
  pending,
}: {
  trend: TrendRef | null;
  caption?: string;
  onRemove: () => void;
  pending: boolean;
}) {
  if (!trend) return <MissingItemCard label="Trend" onRemove={onRemove} pending={pending} />;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-ink/[0.06] bg-cream">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper-warm bg-grain">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trend.imageUrl}
          alt={`${trend.paletteName} in a ${trend.roomType.replace(/_/g, ' ')}`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Pill tone="clay" size="sm">
          Trend
        </Pill>
        <p className="font-display text-[16px] leading-tight text-ink">{trend.headline}</p>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {trend.paletteName} · {trend.roomType.replace(/_/g, ' ')}
        </p>
        {caption ? (
          <p className="mt-1 line-clamp-2 italic text-[12px] text-ink-soft">&ldquo;{caption}&rdquo;</p>
        ) : null}
        <RemoveButton onRemove={onRemove} pending={pending} />
      </div>
    </article>
  );
}

function ProductCard({
  product,
  caption,
  onRemove,
  pending,
}: {
  product: ProductRef | null;
  caption?: string;
  onRemove: () => void;
  pending: boolean;
}) {
  if (!product) return <MissingItemCard label="Product" onRemove={onRemove} pending={pending} />;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-ink/[0.06] bg-cream">
      <Link
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="relative block aspect-square w-full bg-paper-warm bg-grain"
      >
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
          unoptimized
        />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Pill tone="clay" size="sm">
          Product
        </Pill>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {product.retailer}
        </p>
        <p className="line-clamp-2 font-display text-[15px] leading-tight text-ink">
          {product.name}
        </p>
        <p className="font-display text-h4 text-ink">
          {product.priceAud != null
            ? `$${Math.round(product.priceAud).toLocaleString('en-AU')}`
            : 'POA'}
        </p>
        {caption ? (
          <p className="mt-1 line-clamp-2 italic text-[12px] text-ink-soft">&ldquo;{caption}&rdquo;</p>
        ) : null}
        <RemoveButton onRemove={onRemove} pending={pending} />
      </div>
    </article>
  );
}

function NoteCard({
  body,
  onRemove,
  pending,
}: {
  body: string;
  onRemove: () => void;
  pending: boolean;
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-ink/[0.06] bg-cream p-5">
      <Pill tone="clay" size="sm">
        Note
      </Pill>
      <p className="mt-3 flex-1 whitespace-pre-line font-display text-[15px] leading-relaxed text-ink">
        {body}
      </p>
      <RemoveButton onRemove={onRemove} pending={pending} />
    </article>
  );
}

function MissingItemCard({
  label,
  onRemove,
  pending,
}: {
  label: string;
  onRemove: () => void;
  pending: boolean;
}) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-warm bg-grain p-5">
      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        {label} unavailable
      </p>
      <p className="text-[13px] text-ink-soft">
        This item was removed from the catalogue or trend set. You can remove it from the board.
      </p>
      <RemoveButton onRemove={onRemove} pending={pending} />
    </article>
  );
}

function RemoveButton({ onRemove, pending }: { onRemove: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={pending}
      className="mt-auto inline-flex w-fit items-center gap-1 rounded-pill border border-ink/15 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-destructive hover:text-destructive disabled:opacity-40"
    >
      {pending ? 'Removing…' : '✕ Remove'}
    </button>
  );
}

function AddNoteForm({
  boardId,
  onAdded,
}: {
  boardId: string;
  onAdded: () => void;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/vision-boards/${boardId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'note', body: body.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not add note.');
      } else {
        setBody('');
        onAdded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-ink/[0.06] bg-cream p-5 md:p-6">
      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">Add a note</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="A quick note — colour ideas, vibes, must-haves, deal-breakers…"
        rows={3}
        className="mt-3 w-full resize-y rounded-lg border border-ink/[0.06] bg-paper-warm bg-grain px-4 py-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-clay focus:outline-none"
      />
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="cta" size="sm" onClick={add} disabled={submitting || !body.trim()}>
          {submitting ? 'Saving…' : '+ Add note'}
        </Button>
      </div>
    </section>
  );
}
