// Designer-read display. The critique is generated server-side when
// the user submits a render (via /api/render → background after() →
// renders.designer_read column), so this component is now pure
// presentation — it accepts the cached advice as a prop and renders.
//
// During the render wait the advice may not yet be populated; we
// show a placeholder until the next page refresh picks it up.

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
}

export function DesignerRead({ advice }: DesignerReadProps) {
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

      {advice ? <AdviceBlock advice={advice} /> : <ReadingPlaceholder />}
    </section>
  );
}

// Shown during the render wait + briefly after if the designer call is
// still in flight. The page polls render status and will pick up the
// populated advice on the next refresh — usually within 15–25 seconds
// of submission.
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
