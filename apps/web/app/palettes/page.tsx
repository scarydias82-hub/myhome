// /palettes — the dedicated "all 16 palettes" page. Auth-gated like
// /catalogue and /dashboard. Reuses PaletteSwatchCard so the cards
// here are visually identical to the dashboard carousel — same Shop
// / Start project / Save-to-board CTAs.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Button } from '@/components/ui/button';
import {
  PaletteSwatchCard,
  type PaletteCardData,
} from '@/components/palettes/palette-swatch-card';
import { listPalettes, paletteSwatch } from '@/lib/palettes';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PalettesPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/palettes');

  const palettes = listPalettes();
  const cards: PaletteCardData[] = palettes.map((p) => ({
    id: p.id,
    name: p.name,
    vibe: p.vibe,
    trendSource: p.trend_source,
    swatchHexes: paletteSwatch(p),
    timelessness: p.timelessness,
    personaFit: p.persona_fit,
    recommendedRooms: p.recommended_rooms,
  }));

  // Sort: timeless first (descending), then trend-forward (descending).
  // Gives Hamptons Heritage etc. top billing and keeps Federation /
  // mid-century clustered, with the 2026 picks following.
  const sorted = [...cards].sort((a, b) => b.timelessness - a.timelessness);
  const timelessCount = sorted.filter((p) => p.timelessness >= 9).length;

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <Link href="/dashboard" className="hover:text-ink">
              Dashboard
            </Link>
            <Link href="/projects" className="hover:text-ink">
              Projects
            </Link>
            <span className="text-ink">Palettes</span>
            <Link href="/catalogue" className="hover:text-ink">
              Catalogue
            </Link>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container py-10 md:py-14">
        <div className="mb-8 max-w-3xl">
          <Eyebrow>Browse</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            The <em>16 palettes</em>.
          </DisplayHeading>
          <p className="mt-3 text-[15px] text-ink-soft">
            Every render in myMaison is built on one of these colour stories.{' '}
            {timelessCount} sit in the heritage / classic bucket
            (timelessness ≥ 9); the rest are 2026 trend-forward picks
            sourced from WGSN, Pantone, Benjamin Moore, Sherwin-Williams,
            Dulux AU and the year's dominant designer voices. Pick one to
            shop products that match, start a project, or save to a board.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((p) => (
            <li key={p.id}>
              <PaletteSwatchCard palette={p} />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
