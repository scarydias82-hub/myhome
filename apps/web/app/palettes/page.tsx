// /palettes — the full palette catalogue. The dashboard carousel only
// surfaces the curated "popular" subset (~18 palettes) so it stays
// scannable; this page is where users browse all 56+ palettes with
// filter chips by style category.
//
// Single-select URL-param filtering (?tag=neutral) — mirrors the
// catalogue page's UX. Filter chips count their hits live from the
// palette catalogue so an empty filter bucket never shows up.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';
import { listPalettes, paletteSwatch } from '@/lib/palettes';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Filter chip definitions — each chip matches palettes whose tags
// include any of the tag aliases. Order = display order.
const FILTERS: Array<{ slug: string; label: string; tags: string[] }> = [
  { slug: 'popular', label: 'Popular', tags: ['popular'] },
  { slug: 'neutral', label: 'Neutral', tags: ['neutral'] },
  { slug: 'modern', label: 'Modern', tags: ['modern'] },
  { slug: 'natural', label: 'Natural', tags: ['natural'] },
  { slug: 'light', label: 'Light', tags: ['light', 'soft'] },
  { slug: 'warm', label: 'Warm', tags: ['warm', 'earthy'] },
  { slug: 'cool', label: 'Cool', tags: ['cool'] },
  { slug: 'bold', label: 'Bold', tags: ['bold', 'statement', 'rich'] },
  { slug: 'heritage', label: 'Heritage', tags: ['heritage'] },
];

interface SearchParams {
  tag?: string;
}

export default async function PalettesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isSupabaseConfigured) redirect('/login');
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/palettes');

  const allPalettes = listPalettes();

  // Compute counts per filter from the live catalogue so empty
  // buckets are hidden + each chip shows its real population.
  const counts: Record<string, number> = {};
  for (const f of FILTERS) {
    counts[f.slug] = allPalettes.filter((p) =>
      f.tags.some((t) => p.tags.includes(t)),
    ).length;
  }

  // Active filter — single-select. Default sort puts popular palettes
  // first (so even the "All" view leads with the curated set), then
  // falls back to timelessness descending.
  const activeFilter = FILTERS.find((f) => f.slug === params.tag) ?? null;
  const filteredPalettes = activeFilter
    ? allPalettes.filter((p) => activeFilter.tags.some((t) => p.tags.includes(t)))
    : allPalettes;

  const sortedPalettes = [...filteredPalettes].sort((a, b) => {
    const aPopular = a.tags.includes('popular') ? 1 : 0;
    const bPopular = b.tags.includes('popular') ? 1 : 0;
    if (aPopular !== bPopular) return bPopular - aPopular;
    return (b.timelessness ?? 0) - (a.timelessness ?? 0);
  });

  function buildHref(next: Partial<SearchParams>) {
    const merged: SearchParams = { ...params, ...next };
    Object.keys(merged).forEach((k) => {
      if (!merged[k as keyof SearchParams]) delete merged[k as keyof SearchParams];
    });
    const qs = new URLSearchParams(merged as Record<string, string>).toString();
    return `/palettes${qs ? `?${qs}` : ''}`;
  }

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
            <Link href="/projects" className="hover:text-ink">Projects</Link>
            <Link href="/vision-boards" className="hover:text-ink">Vision boards</Link>
            <Link href="/catalogue" className="hover:text-ink">Catalogue</Link>
            <span className="text-ink">Palettes</span>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container py-10 md:py-14">
        <div className="mb-8 max-w-2xl md:mb-10">
          <Eyebrow>Browse</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            The <em>palette catalogue</em>.
          </DisplayHeading>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            {allPalettes.length} colour palettes — modern neutrals, naturals, soft pastels,
            heritage frameworks and bold accents. Each carries a timelessness rating and persona
            tags so the designer can match palette to person. Pick one to shop, start a project,
            or save to a vision board.
          </p>
        </div>

        {/* Filter chips — single-select, live counts. */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Filter ·
          </span>
          <Link href={buildHref({ tag: undefined })} className={chipClass(!params.tag)}>
            All ({allPalettes.length})
          </Link>
          {FILTERS.map((f) => {
            const count = counts[f.slug] ?? 0;
            if (count === 0) return null;
            return (
              <Link
                key={f.slug}
                href={buildHref({ tag: f.slug })}
                className={chipClass(params.tag === f.slug)}
              >
                {f.label} ({count})
              </Link>
            );
          })}
        </div>

        {sortedPalettes.length === 0 ? (
          <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-12 text-center">
            <p className="font-display text-h3 text-ink">No palettes match that filter.</p>
            <p className="mt-2 text-[14px] text-ink-soft">
              Try a different category or clear the filter.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {sortedPalettes.map((p) => {
              const swatch = paletteSwatch(p);
              const isPopular = p.tags.includes('popular');
              return (
                <li key={p.id}>
                  <article className="flex h-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft">
                    {/* Big 5-stripe swatch — same visual anchor as the
                        dashboard carousel cards so the catalogue feels
                        continuous with the dashboard. */}
                    <div className="grid h-28 grid-cols-5">
                      {swatch.slice(0, 5).map((hex, i) => (
                        <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {isPopular ? (
                          <Pill tone="clay" size="sm">
                            Popular
                          </Pill>
                        ) : null}
                        <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                          T {p.timelessness}/10
                        </span>
                      </div>
                      <p className="font-display text-[18px] leading-tight text-ink">{p.name}</p>
                      <p className="line-clamp-2 font-dmsans text-[12px] leading-relaxed text-ink-soft">
                        {p.vibe}
                      </p>
                      <p className="line-clamp-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        {p.trend_source}
                      </p>
                      {/* Shop / project / save — mirrors the dashboard
                          carousel card so users get the same CTAs in
                          both views. */}
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                        <Link
                          href={`/catalogue?palette=${p.id}`}
                          className="rounded-full bg-ink px-3 py-1.5 font-dmsans text-[11px] font-medium text-paper transition hover:opacity-90"
                        >
                          ✦ Shop
                        </Link>
                        <Link
                          href={`/projects/new?palette=${p.id}`}
                          className="rounded-full border border-ink/15 px-3 py-1.5 font-dmsans text-[11px] font-medium text-ink transition hover:bg-paper-warm"
                        >
                          Start a project
                        </Link>
                        <AddToVisionBoardButton
                          itemRef={{ itemType: 'palette', paletteId: p.id }}
                          variant="compact"
                        />
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-12 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {sortedPalettes.length} of {allPalettes.length} palettes shown
        </p>
      </main>
    </>
  );
}

function chipClass(active: boolean): string {
  return [
    'rounded-pill px-4 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
    active
      ? 'bg-ink text-paper'
      : 'border border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
  ].join(' ');
}
