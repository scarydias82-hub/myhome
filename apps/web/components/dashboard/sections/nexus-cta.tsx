import Link from 'next/link';
import { cn } from '@/lib/utils';

interface NexusCTAProps {
  // Step status, computed in the server component:
  //  - 'done'   = already completed for this user
  //  - 'active' = current state of the in-flight project
  //  - 'future' = next ahead, not yet reached
  steps: {
    inspiration: StepState;
    siteAnalysed: StepState;
    productsMatched: StepState;
    rendered: StepState;
    shopped: StepState;
  };
  activeProject: { id: string; name: string } | null;
}

type StepState = 'done' | 'active' | 'future';

interface Step {
  key: keyof NexusCTAProps['steps'];
  number: string;
  label: string;
}

const STEPS: Step[] = [
  { key: 'inspiration', number: '01', label: 'Inspiration absorbed' },
  { key: 'siteAnalysed', number: '02', label: 'Room analysed' },
  { key: 'productsMatched', number: '03', label: 'Products matched' },
  { key: 'rendered', number: '04', label: 'Rendered in your room' },
  { key: 'shopped', number: '05', label: 'Shopped & quoted' },
];

export function NexusCTA({ steps, activeProject }: NexusCTAProps) {
  return (
    <section className="relative my-12 overflow-hidden rounded-3xl bg-editorial-ink px-8 py-14 text-editorial-cream md:px-14 md:py-16">
      {/* Cognac decorative circles */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-editorial-cognac/20"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full border border-editorial-cognac/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-12 top-12 h-2 w-2 rounded-full bg-editorial-cognac"
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <p className="font-dmmono text-[11px] uppercase tracking-[0.16em] text-editorial-cognac">
          The myMaison nexus
        </p>
        <h2 className="mt-4 font-serif text-[34px] leading-[1.1] text-editorial-cream md:text-[40px]">
          Abstract idea → <em className="italic">fully shopped room</em>
        </h2>
        <p className="mt-4 font-dmsans text-[14px] leading-relaxed text-editorial-cream/70">
          Pinterest aesthetic, Claude vision, fal Flux generation, AU retailer catalogue, and a
          designer LLM read — all converge into one pipeline so you move from intent to
          decision in minutes, not weekends.
        </p>
      </div>

      <ol className="relative mx-auto mt-12 grid max-w-5xl gap-3 md:grid-cols-5">
        {STEPS.map((step) => {
          const state = steps[step.key];
          return (
            <li
              key={step.key}
              className={cn(
                'flex flex-col gap-3 rounded-2xl border p-4 text-left transition',
                state === 'done' && 'border-editorial-cognac bg-editorial-cognac text-editorial-ink',
                state === 'active' && 'border-editorial-cream bg-editorial-cream text-editorial-ink',
                state === 'future' && 'border-editorial-cream/15 bg-editorial-ink/40 text-editorial-cream/70',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-dmmono text-[10px] uppercase tracking-[0.12em]">
                  {step.number}
                </span>
                <span aria-hidden className="font-dmmono text-[12px]">
                  {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                </span>
              </div>
              <p className="font-serif text-[15px] leading-tight">{step.label}</p>
            </li>
          );
        })}
      </ol>

      <div className="relative mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
        {activeProject ? (
          <Link
            href={`/projects/${activeProject.id}`}
            className="rounded-full bg-editorial-cognac px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-ink transition hover:opacity-90"
          >
            ✦ Continue {activeProject.name} →
          </Link>
        ) : null}
        <Link
          href="/projects/new"
          className="rounded-full border border-editorial-cream/40 px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-cream transition hover:bg-editorial-cream/10"
        >
          Start something new
        </Link>
      </div>
    </section>
  );
}
