'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { listPalettes, paletteSwatch, type Palette } from '@/lib/palettes';
import { cn } from '@/lib/utils';

interface DesignerRecommendation {
  product: string;
  retailer: string;
  price: string;
  whyThisRoom: string;
  placement: string;
  scaleCheck: string;
}

interface DesignerAdvice {
  designerRead: string;
  recommendations: DesignerRecommendation[];
  compositionNote: string;
  watchOutFor: string;
  nextStep: string;
}

interface DesignerReadProps {
  renderId: string;
}

export function DesignerRead({ renderId }: DesignerReadProps) {
  const palettes = listPalettes();
  const [selectedId, setSelectedId] = useState<string>(palettes[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<DesignerAdvice | null>(null);

  async function requestAdvice() {
    setLoading(true);
    setError(null);
    setAdvice(null);
    try {
      const res = await fetch('/api/advise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ renderId, paletteId: selectedId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Designer is offline right now. Try again.');
        return;
      }
      setAdvice(json.advice as DesignerAdvice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink/[0.06] bg-cream">
      <div className="border-b border-ink/[0.06] p-6">
        <Eyebrow>Designer read</Eyebrow>
        <DisplayHeading level={3} className="mt-2">
          Get a senior designer's <em>read</em> on this room.
        </DisplayHeading>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          Pick a 2026 palette below. Claude Sonnet analyses your room photo, picks 3–5 specific
          products from the AU catalogue, and tells you exactly why each one works — including
          placement, scale check, and what existing pieces to watch.
        </p>
      </div>

      <div className="p-6">
        <Eyebrow>Step 01 · Pick a palette</Eyebrow>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {palettes.map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              selected={selectedId === p.id}
              onSelect={() => setSelectedId(p.id)}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button variant="cta" size="lg" onClick={requestAdvice} disabled={loading || !selectedId}>
            {loading ? 'Designer is thinking… (~20s)' : advice ? 'Re-run with this palette' : 'Get designer read'}
          </Button>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Powered by Claude Sonnet 4.6 · vision + reasoning
          </p>
        </div>

        {error ? <p className="mt-4 text-[14px] text-destructive">{error}</p> : null}
      </div>

      {advice ? <AdviceBlock advice={advice} /> : null}
    </section>
  );
}

function PaletteCard({
  palette,
  selected,
  onSelect,
}: {
  palette: Palette;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border p-4 text-left transition',
        selected
          ? 'border-clay/60 bg-cream shadow-soft'
          : 'border-ink/[0.06] bg-paper-warm bg-grain hover:border-ink/20 hover:bg-cream',
      )}
    >
      <PaletteStrip colors={paletteSwatch(palette)} className="h-7" />
      <div>
        <p className="font-display text-h4 text-ink">{palette.name}</p>
        <p className="mt-1 text-[13px] text-ink-soft">{palette.vibe}</p>
      </div>
      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        {palette.tags.slice(0, 2).join(' · ')}
      </p>
    </button>
  );
}

function AdviceBlock({ advice }: { advice: DesignerAdvice }) {
  return (
    <div className="space-y-8 border-t border-ink/[0.06] p-6 md:p-8">
      <div>
        <Eyebrow>Designer read</Eyebrow>
        <p className="mt-3 max-w-3xl font-display text-[20px] leading-snug text-ink">
          {advice.designerRead}
        </p>
      </div>

      {advice.recommendations.length > 0 ? (
        <div>
          <Eyebrow>Recommendations</Eyebrow>
          <ol className="mt-4 space-y-5">
            {advice.recommendations.map((r, i) => (
              <li
                key={`${r.product}-${i}`}
                className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="font-display text-h4 text-ink">
                    {i + 1}. {r.product}
                  </p>
                  <div className="flex items-center gap-2">
                    {r.retailer ? <Pill tone="cream">{r.retailer}</Pill> : null}
                    {r.price ? (
                      <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        {r.price}
                      </span>
                    ) : null}
                  </div>
                </div>
                {r.whyThisRoom ? (
                  <p className="mt-3 text-[15px] leading-relaxed text-ink">
                    <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      Why this room ·{' '}
                    </span>
                    {r.whyThisRoom}
                  </p>
                ) : null}
                {r.placement ? (
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                    <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      Placement ·{' '}
                    </span>
                    {r.placement}
                  </p>
                ) : null}
                {r.scaleCheck ? (
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                    <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      Scale ·{' '}
                    </span>
                    {r.scaleCheck}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {advice.compositionNote ? (
        <div>
          <Eyebrow>Composition note</Eyebrow>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">
            {advice.compositionNote}
          </p>
        </div>
      ) : null}

      {advice.watchOutFor ? (
        <div>
          <Eyebrow tone="faint">Watch out for</Eyebrow>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">
            {advice.watchOutFor}
          </p>
        </div>
      ) : null}

      {advice.nextStep ? (
        <div className="rounded-xl bg-ink p-5 text-paper">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-paper/70">
            Next step
          </p>
          <p className="mt-2 font-display text-[18px] leading-snug">{advice.nextStep}</p>
        </div>
      ) : null}
    </div>
  );
}
