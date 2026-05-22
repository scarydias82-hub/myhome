// /palettes — the full palette catalogue. The dashboard carousel surfaces
// the community-popular + user-liked subset; this page is where users
// browse all 56+ palettes with filter chips by style category.
//
// "Your likes" filter chip surfaces only the palettes the current user
// has hearted. "Popular" filter is dynamic — palettes with the most
// aggregate likes across all users (editorial popular tag as cold-start).
//
// Within any filter, palettes sort lightest → darkest by wall-colour
// luminance, matching the dashboard carousel order so both surfaces
// feel coherent.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Button } from '@/components/ui/button';
import { AddToVisionBoardButton } from '@/components/vision-boards/add-to-vision-board-button';
import { PaletteLikeButton } from '@/components/palettes/palette-like-button';
import { listPalettes, paletteSwatch, paletteBrightness } from '@/lib/palettes';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Filter chip definitions. "your-likes" and "popular" are dynamic (DB-
// driven); the rest match palettes whose tags include any of the aliases.
const STATIC_FILTERS: Array<{ slug: string; label: string; tags: string[] }> = [
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

type PaletteLikeRow = { user_id: string; palette_id: string };

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

  // Fetch all palette likes in one round-trip. Cast through `any` —
  // palette_likes is a recent migration not yet in generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: likesData } = await (supabase as any)
    .from('palette_likes')
    .select('user_id, palette_id')
    .limit(5000);
  const allLikes = (likesData as PaletteLikeRow[] | null) ?? [];

  // Aggregate like counts + current user's liked set.
  const likeCountMap = new Map<string, number>();
  for (const row of allLikes) {
    likeCountMap.set(row.palette_id, (likeCountMap.get(row.palette_id) ?? 0) + 1);
  }
  const userLikedIds = new Set(
    allLikes.filter((l) => l.user_id === user.id).map((l) => l.palette_id),
  );

  // "Popular" palette IDs: top 18 by aggregate likes, or editorial popular
  // tag fallback on cold-start.
  const popularIds: Set<string> =
    likeCountMap.size > 0
      ? new Set(
          [...likeCountMap.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 18)
            .map(([id]) => id),
        )
      : new Set(allPalettes.filter((p) => p.tags.includes('popular')).map((p) => p.id));

  // Per-filter counts for the chips.
  const counts: Record<string, number> = {
    'your-likes': userLikedIds.size,
    popular: popularIds.size,
  };
  for (const f of STATIC_FILTERS) {
    counts[f.slug] = allPalettes.filter((p) => f.tags.some((t) => p.tags.includes(t))).length;
  }

  // Apply active filter.
  const activeTag = params.tag;
  let filteredPalettes = allPalettes;
  if (activeTag === 'your-likes') {
    filteredPalettes = allPalettes.filter((p) => userLikedIds.has(p.id));
  } else if (activeTag === 'popular') {
    filteredPalettes = allPalettes.filter((p) => popularIds.has(p.id));
  } else {
    const staticFilter = STATIC_FILTERS.find((f) => f.slug === activeTag);
    if (staticFilter) {
      filteredPalettes = allPalettes.filter((p) =>
        staticFilter.tags.some((t) => p.tags.includes(t)),
      );
    }
  }

  // Sort lightest → darkest (consistent with dashboard carousel).
  const sortedPalettes = [...filteredPalettes].sort(
    (a, b) => paletteBrightness(b) - paletteBrightness(a),
  );

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
            heritage frameworks and bold accents. Heart a palette to keep it in your dashboard
            carousel. Ordered lightest to darkest.
          </p>
        </div>

        {/* Filter chips */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Filter ·
          </span>
          <Link href={buildHref({ tag: undefined })} className={chipClass(!activeTag)}>
            All ({allPalettes.length})
          </Link>
          {/* Dynamic chips — DB-driven counts */}
          {userLikedIds.size > 0 && (
            <Link
              href={buildHref({ tag: 'your-likes' })}
              className={chipClass(activeTag === 'your-likes')}
            >
              ♥ Your likes ({userLikedIds.size})
            </Link>
          )}
          <Link
            href={buildHref({ tag: 'popular' })}
            className={chipClass(activeTag === 'popular')}
          >
            Popular ({popularIds.size})
          </Link>
          {/* Static tag-based chips */}
          {STATIC_FILTERS.map((f) => {
            const count = counts[f.slug] ?? 0;
            if (count === 0) return null;
            return (
              <Link
                key={f.slug}
                href={buildHref({ tag: f.slug })}
                className={chipClass(activeTag === f.slug)}
              >
                {f.label} ({count})
              </Link>
            );
          })}
        </div>

        {sortedPalettes.length === 0 ? (
          <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-12 text-center">
            <p className="font-display text-h3 text-ink">
              {activeTag === 'your-likes'
                ? 'No liked palettes yet.'
                : 'No palettes match that filter.'}
            </p>
            <p className="mt-2 text-[14px] text-ink-soft">
              {activeTag === 'your-likes'
                ? 'Heart a palette below to save it here and keep it in your dashboard.'
                : 'Try a different category or clear the filter.'}
            </p>
            {activeTag === 'your-likes' && (
              <Link
                href={buildHref({ tag: undefined })}
                className="mt-4 inline-block font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
              >
                Browse all palettes →
              </Link>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {sortedPalettes.map((p) => {
              const swatch = paletteSwatch(p);
              const likeCount = likeCountMap.get(p.id) ?? 0;
              const likedByUser = userLikedIds.has(p.id);
              return (
                <li key={p.id}>
                  <article className="flex h-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft">
                    <div className="grid h-28 grid-cols-5">
                      {swatch.slice(0, 5).map((hex, i) => (
                        <div key={`${hex}-${i}`} style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {popularIds.has(p.id) && (
                          <span className="rounded-pill bg-clay/12 px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-clay">
                            Popular
                          </span>
                        )}
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
                        <PaletteLikeButton
                          paletteId={p.id}
                          initialLiked={likedByUser}
                          initialCount={likeCount}
                          variant="compact"
                        />
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
