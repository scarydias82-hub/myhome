import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';

interface PhaseDef {
  key: string;
  number: string;
  name: string;
  blurb: string;
  href: string;
  cta: string;
}

const PHASES: PhaseDef[] = [
  {
    key: 'brief',
    number: '01',
    name: 'Brief',
    blurb:
      'Budget, lifestyle, must-keep items, dealbreakers. The constraints that frame every later decision.',
    href: '#brief',
    cta: 'Write the brief',
  },
  {
    key: 'site',
    number: '02',
    name: 'Site analysis',
    blurb:
      'Upload a room photo. Claude vision reads dimensions, light direction, existing materials, architecture.',
    href: '#site',
    cta: 'Add room photo',
  },
  {
    key: 'inspiration',
    number: '03',
    name: 'Inspiration',
    blurb:
      "Pinterest boards, magazine clippings, mood references. The aesthetic 'why' that shapes the brief into a look.",
    href: '#inspiration',
    cta: 'Connect Pinterest',
  },
  {
    key: 'concept',
    number: '04',
    name: 'Concept',
    blurb:
      'Palette + materials + style direction. The translation of inspiration into specifiable parameters.',
    href: '#concept',
    cta: 'Pick palette',
  },
  {
    key: 'design',
    number: '05',
    name: 'Design',
    blurb:
      'Hero products selected from the AU catalogue. Scale + price + availability verified before generation.',
    href: '#design',
    cta: 'Select hero products',
  },
  {
    key: 'proposal',
    number: '06',
    name: 'Proposal',
    blurb:
      'Flux renders the briefed room. Every upstream phase informs the prompt. No shot-in-the-dark generation.',
    href: '#proposal',
    cta: 'Generate proposal',
  },
  {
    key: 'spec',
    number: '07',
    name: 'Spec sheet',
    blurb: 'Picking list, totals, retailer links. The deliverable you act on.',
    href: '#spec',
    cta: 'View spec',
  },
];

interface ProjectPhasesProps {
  projectId: string;
  briefDone: boolean;
  siteDone: boolean;
  inspirationDone: boolean;
  designDone: boolean;
  proposalDone: boolean;
}

export function ProjectPhases({
  projectId,
  briefDone,
  siteDone,
  inspirationDone,
  designDone,
  proposalDone,
}: ProjectPhasesProps) {
  const done = {
    brief: briefDone,
    site: siteDone,
    inspiration: inspirationDone,
    concept: false,
    design: designDone,
    proposal: proposalDone,
    spec: proposalDone,
  } as const;

  return (
    <section>
      <Eyebrow>Curation phases</Eyebrow>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
        Standard residential design lifecycle. Work through each phase before generating — the
        more curated the upstream, the better Flux renders the downstream.
      </p>
      <ol className="mt-6 space-y-3">
        {PHASES.map((phase) => {
          const isDone = done[phase.key as keyof typeof done];
          return (
            <li key={phase.key}>
              <div
                className={cn(
                  'flex flex-col gap-3 rounded-xl border p-5 transition md:flex-row md:items-center md:justify-between',
                  isDone
                    ? 'border-olive/40 bg-cream'
                    : 'border-ink/[0.06] bg-paper-warm bg-grain',
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-meta',
                      isDone
                        ? 'bg-olive text-paper'
                        : 'border border-ink/15 bg-paper text-ink-faint',
                    )}
                  >
                    {isDone ? '✓' : phase.number}
                  </div>
                  <div>
                    <p className="font-display text-h4 text-ink">{phase.name}</p>
                    <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
                      {phase.blurb}
                    </p>
                  </div>
                </div>
                <PhaseAction phase={phase} projectId={projectId} done={isDone} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PhaseAction({
  phase,
  projectId,
  done,
}: {
  phase: PhaseDef;
  projectId: string;
  done: boolean;
}) {
  const href = phaseHref(phase, projectId);
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 rounded-pill px-5 py-2 font-mono text-meta uppercase tracking-eyebrow transition',
        done
          ? 'bg-cream text-ink-soft hover:bg-ink/5'
          : 'bg-ink text-paper hover:bg-ink-soft',
      )}
    >
      {done ? 'Edit' : phase.cta}
    </Link>
  );
}

function phaseHref(phase: PhaseDef, projectId: string): string {
  switch (phase.key) {
    case 'site':
      return `/rooms/new?projectId=${projectId}`;
    case 'inspiration':
      return `/projects/${projectId}/inspiration`;
    case 'brief':
      return `/projects/${projectId}/brief`;
    default:
      return `/projects/${projectId}#${phase.key}`;
  }
}
