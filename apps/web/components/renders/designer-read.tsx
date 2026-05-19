'use client';

// Designer-read display + self-healing fetch.
//
// The render flow tries to populate renders.designer_read in three places,
// in order of preference:
//   1. /api/render after() block (optimistic — fires when user submits)
//   2. /api/advise direct call (client fallback below)
//   3. The 20260520100000 migration backfills don't apply here — this
//      is per-render
//
// When the server page hands us a populated advice prop, render it.
// When it doesn't, fire off /api/advise on mount so the user isn't
// stuck staring at a "reading the room" placeholder forever.
// /api/advise is idempotent (checks designer_read first) so concurrent
// renders don't double-spend.

import { useEffect, useState } from 'react';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';

interface DesignerRecommendation {
  product: string;
  retailer: string;
  price: string;
  whyThisRoom: string;
  placement: string;
  scaleCheck: string;
}

export interface DesignerAdvice {
  designerRead: string;
  recommendations: DesignerRecommendation[];
  compositionNote: string;
  watchOutFor: string;
  nextStep: string;
}

interface DesignerReadProps {
  advice: DesignerAdvice | null;
  renderId: string;
}

export function DesignerRead({ advice: initialAdvice, renderId }: DesignerReadProps) {
  const [advice, setAdvice] = useState<DesignerAdvice | null>(initialAdvice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Server already has it — nothing to do.
    if (initialAdvice) {
      setAdvice(initialAdvice);
      return;
    }
    // Already fetching or already errored — don't refire.
    if (loading || error) return;

    let cancelled = false;
    setLoading(true);
    fetch('/api/advise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ renderId }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          advice?: DesignerAdvice;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.advice) {
          setError(json.error ?? `Designer call failed (HTTP ${res.status})`);
          return;
        }
        setAdvice(json.advice);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Designer call failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // initialAdvice intentionally excluded — we only ever read it on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderId]);

  return (
    <section className="rounded-xl border border-ink/[0.06] bg-cream">
      <header className="border-b border-ink/[0.06] p-6">
        <Eyebrow>Designer read</Eyebrow>
        <DisplayHeading level={3} className="mt-2">
          A senior designer's <em>read</em> on this room.
        </DisplayHeading>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          Claude Sonnet reads your room photo and the palette you picked,
          then writes a designer's-eye critique with specific product
          recommendations, placement notes, and what to watch in your
          existing space.
        </p>
      </header>

      {advice ? (
        <AdviceBlock advice={advice} />
      ) : error ? (
        <ReadingError message={error} />
      ) : (
        <ReadingPlaceholder />
      )}
    </section>
  );
}

// Loading state — also shown on the very first page load before /api/advise
// has had time to respond. Pulsing dot signals work-in-progress.
function ReadingPlaceholder() {
  return (
    <div className="p-6 md:p-8">
      <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-2 w-2 animate-pulse rounded-full bg-clay"
          />
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Reading the room
          </p>
        </div>
        <p className="mt-3 max-w-md font-display text-[20px] leading-snug text-ink">
          Claude is looking at your room photo, considering the palette,
          and drafting recommendations.
        </p>
        <p className="mt-2 max-w-md text-[14px] text-ink-soft">
          Usually 15 to 25 seconds. The render is building in parallel —
          both should land soon.
        </p>
      </div>
    </div>
  );
}

// Error state — shown when /api/advise fails. Surfaces the underlying
// message so we can debug without digging into Vercel logs.
function ReadingError({ message }: { message: string }) {
  return (
    <div className="p-6 md:p-8">
      <div className="rounded-xl border-l-2 border-clay bg-paper-warm p-6">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
          Designer offline
        </p>
        <p className="mt-2 max-w-md font-display text-[18px] leading-snug text-ink">
          The designer call didn't come back.
        </p>
        <p className="mt-2 max-w-md text-[13px] text-ink-soft">{message}</p>
        <p className="mt-3 max-w-md text-[12px] text-ink-faint">
          The render is unaffected. Refresh the page to try again, or move
          on — your shoppable picking list is below.
        </p>
      </div>
    </div>
  );
}

function AdviceBlock({ advice }: { advice: DesignerAdvice }) {
  return (
    <div className="space-y-8 p-6 md:p-8">
      <div>
        <Eyebrow>The read</Eyebrow>
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
