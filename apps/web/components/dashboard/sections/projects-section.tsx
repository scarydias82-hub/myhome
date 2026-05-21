import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { PaletteStrip } from '@/components/dashboard/shared/palette-strip';
import { Tag } from '@/components/dashboard/shared/tag';

export interface DashboardProjectCard {
  id: string;
  name: string;
  roomType: string | null;
  status: 'shopping' | 'in_progress' | 'planning';
  paletteHexes: string[];
  progress: number; // 0..100
  itemCount: number;
  budgetAud: number | null;
}

interface ProjectsSectionProps {
  projects: DashboardProjectCard[];
}

const STATUS_TONE: Record<DashboardProjectCard['status'], Parameters<typeof Tag>[0]['tone']> = {
  shopping: 'cognac',
  in_progress: 'sage',
  planning: 'taupe',
};

const STATUS_LABEL: Record<DashboardProjectCard['status'], string> = {
  shopping: 'Shopping',
  in_progress: 'In progress',
  planning: 'Planning',
};

export function ProjectsSection({ projects }: ProjectsSectionProps) {
  // Empty-state: hide entirely. The quick-actions tile up top already
  // surfaces "Start a project" so we don't need a redundant empty
  // panel here. Saves vertical real estate on mobile.
  if (projects.length === 0) return null;

  return (
    <section id="projects" className="py-8 md:py-10">
      <SectionHeader
        title="Your projects"
        action={{ label: '+ New project', href: '/projects/new' }}
      />

      {/* Horizontal snap-scroll. Cards are narrower than the previous
          full-bleed grid because the dashboard is now product-first
          and the projects strip is a navigation aid, not the
          centrepiece. Mobile basis lets ~1.3 cards peek into view so
          the swipe affordance is obvious. */}
      <div className="-mx-4 overflow-x-auto pb-3 md:-mx-2 [scrollbar-width:thin]">
        <ul className="flex snap-x snap-mandatory gap-3 px-4 md:gap-4 md:px-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="snap-start shrink-0 basis-[260px] md:basis-[280px]"
            >
              <Link
                href={`/projects/${p.id}`}
                className="group flex h-full flex-col rounded-2xl border border-editorial-border bg-editorial-surface p-5 transition hover:border-editorial-borderStrong"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 font-serif text-[16px] leading-tight text-editorial-ink md:text-[17px]">
                    {p.name}
                  </p>
                  <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Tag>
                </div>
                {p.roomType ? (
                  <p className="mt-1 font-dmmono text-[10px] uppercase tracking-[0.1em] text-editorial-taupe">
                    {p.roomType.replace(/_/g, ' ')}
                  </p>
                ) : null}
                <PaletteStrip colors={p.paletteHexes.slice(0, 5)} className="mt-4" />
                <div className="mt-4">
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(p.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1 overflow-hidden rounded-full bg-editorial-border"
                  >
                    <div
                      className="h-full bg-editorial-cognac transition-[width] duration-[600ms] ease-out"
                      style={{ width: `${Math.max(0, Math.min(100, p.progress))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between font-dmmono text-[10px] uppercase tracking-[0.1em] text-editorial-taupe">
                    <span>{p.itemCount} items</span>
                    <span className="tabular-nums text-editorial-ink">
                      {p.budgetAud != null
                        ? `$${Math.round(p.budgetAud).toLocaleString('en-AU')}`
                        : '—'}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}

          {/* "New project" tile — same width as a card, sits at the
              end of the strip so the user can swipe to "add another"
              naturally. */}
          <li className="snap-start shrink-0 basis-[260px] md:basis-[280px]">
            <Link
              href="/projects/new"
              className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-editorial-borderStrong p-5 text-center transition hover:bg-editorial-surface"
            >
              <span aria-hidden className="text-editorial-cognac text-[22px]">+</span>
              <p className="font-serif text-[16px] text-editorial-ink">Start a new project</p>
              <p className="font-dmsans text-[12px] text-editorial-taupe">
                Name it, brief it, render it.
              </p>
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
