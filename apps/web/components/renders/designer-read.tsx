'use client';

// Designer commentary display + self-healing fetch.
//
// 2026-05-22 rewrite: tone flipped to excited / products-first per the
// owner directive. The component now renders a tight three-section
// commentary (designer read of the render + palette story + invite to
// keep exploring) and intentionally removes:
//   - The descriptive intro paragraph ("Claude Sonnet reads your
//     room…") — replaced with the commentary speaking for itself
//   - The "Watch out for" / "Next step" sections — those were the
//     critique surfaces the owner asked us to retire
//   - Per-product reasoning blocks — the category carousels show the
//     products directly now, so we don't repeat the work
//
// Backwards-compatibility: pre-rewrite designer_read JSON rows have
// the old shape (designerRead + recommendations + compositionNote +
// watchOutFor + nextStep). The new render path returns the new shape
// (designerRead + paletteStory + exploreInvite). The component
// tolerates either — if paletteStory and exploreInvite are missing,
// it falls back to showing just the original designerRead and a
// short default invite so the page still works while old renders are
// re-rendered or aged out.
//
// The fetch fallback (calls /api/advise on mount when initialAdvice
// is null) is unchanged — /api/advise is idempotent and returns the
// new shape.

import { useEffect, useState } from 'react';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';

export interface DesignerAdvice {
  designerRead: string;
  paletteStory?: string;
  exploreInvite?: string;
  // Legacy fields tolerated on old rows. Not rendered post-rewrite —
  // present so the JSON parses without errors.
  recommendations?: unknown[];
  compositionNote?: string;
  watchOutFor?: string;
  nextStep?: string;
}

interface DesignerReadProps {
  advice: DesignerAdvice | null;
  renderId: string;
  /** Optional palette name (e.g. "Warm Grounded Earth"). Surfaced in
   *  the placeholder so the wait state feels personalised rather than
   *  generic ("reading your warm grounded earth bedroom" beats
   *  "reading the room"). */
  paletteName?: string | null;
  /** Optional human room label (e.g. "west-facing bedroom"). Same
   *  goal — fold into the placeholder so the user sees we know what
   *  they uploaded. */
  roomLabel?: string | null;
}

export function DesignerRead({
  advice: initialAdvice,
  renderId,
  paletteName,
  roomLabel,
}: DesignerReadProps) {
  const [advice, setAdvice] = useState<DesignerAdvice | null>(initialAdvice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAdvice) {
      setAdvice(initialAdvice);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderId]);

  return (
    <section className="rounded-xl border border-ink/[0.06] bg-cream">
      <header className="border-b border-ink/[0.06] p-6">
        <Eyebrow>Designer read</Eyebrow>
        <DisplayHeading level={3} className="mt-2">
          Your <em>curated</em> picks.
        </DisplayHeading>
      </header>

      {advice ? (
        <AdviceBlock advice={advice} />
      ) : error ? (
        <ReadingError message={error} />
      ) : (
        <ReadingPlaceholder paletteName={paletteName} roomLabel={roomLabel} />
      )}
    </section>
  );
}

function ReadingPlaceholder({
  paletteName,
  roomLabel,
}: {
  paletteName?: string | null;
  roomLabel?: string | null;
}) {
  const headline =
    paletteName && roomLabel
      ? `Bringing ${paletteName} to life in your ${roomLabel}.`
      : paletteName
        ? `Bringing ${paletteName} to life.`
        : roomLabel
          ? `Reading your ${roomLabel}.`
          : 'Putting your picks together.';

  return (
    <div className="p-6 md:p-8">
      <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-2 w-2 animate-pulse rounded-full bg-clay"
          />
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Designer at work
          </p>
        </div>
        <p className="mt-3 max-w-md font-display text-[22px] leading-snug text-ink">
          {headline}
        </p>
        <p className="mt-2 max-w-md text-[14px] text-ink-soft">
          Your render's ready — your curator is writing a short read on
          what's in it and how it ties to the palette. Usually 15 to 25
          seconds.
        </p>
      </div>
    </div>
  );
}

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
          The render is unaffected. Refresh the page to try again, or
          scroll on — your shoppable carousels are below.
        </p>
      </div>
    </div>
  );
}

function AdviceBlock({ advice }: { advice: DesignerAdvice }) {
  return (
    <div className="space-y-8 p-6 md:p-8">
      {advice.designerRead ? (
        <div>
          <Eyebrow>The read</Eyebrow>
          <p className="mt-3 max-w-3xl font-display text-[20px] leading-snug text-ink">
            {advice.designerRead}
          </p>
        </div>
      ) : null}

      {advice.paletteStory ? (
        <div>
          <Eyebrow>Palette story</Eyebrow>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">
            {advice.paletteStory}
          </p>
        </div>
      ) : null}

      {advice.exploreInvite ? (
        <div className="rounded-xl bg-ink p-5 text-paper">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-paper/70">
            Keep exploring
          </p>
          <p className="mt-2 font-display text-[18px] leading-snug">
            {advice.exploreInvite}
          </p>
        </div>
      ) : null}
    </div>
  );
}
