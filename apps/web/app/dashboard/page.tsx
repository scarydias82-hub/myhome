import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPalettes, paletteSwatch } from '@/lib/palettes';

export const dynamic = 'force-dynamic';

const HERO_CATEGORIES = [
  'Sofas',
  'Chairs',
  'Coffee Tables',
  'Dining',
  'Beds',
  'Lighting',
  'Rugs',
];

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  brief: unknown;
  pinterest_style_profile_id: string | null;
}

interface RenderRow {
  id: string;
  status: string;
  output_url: string | null;
  created_at: string;
}

interface TrendRow {
  id: string;
  palette_id: string;
  palette_name: string;
  room_type: string;
  headline: string;
  description: string;
  image_storage_key: string;
  source_signal: string | null;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');
  const firstName = user.email?.split('@')[0] ?? 'there';

  const [
    projectsRes,
    rendersRes,
    pinterestRes,
    trendsRes,
    productsRes,
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, updated_at, brief, pinterest_style_profile_id')
      .order('updated_at', { ascending: false })
      .limit(4),
    supabase
      .from('renders')
      .select('id, status, output_url, created_at')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('pinterest_connections')
      .select('user_id, connected_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('trend_cards')
      .select('id, palette_id, palette_name, room_type, headline, description, image_storage_key, source_signal')
      .limit(6),
    supabase
      .from('products')
      .select('id, name, retailer, category, price_aud, image_url')
      .in('category', HERO_CATEGORIES)
      .not('image_url', 'is', null)
      .order('price_aud', { ascending: false, nullsFirst: false })
      .limit(8),
  ]);

  const projects = (projectsRes.data as ProjectRow[] | null) ?? [];
  const renders = (rendersRes.data as RenderRow[] | null) ?? [];
  const trends = (trendsRes.data as TrendRow[] | null) ?? [];
  const products = (productsRes.data as ProductRow[] | null) ?? [];
  const pinterestConnected = Boolean(pinterestRes.data);

  // Sign render thumbnails (private bucket).
  const admin = createAdminClient();
  const renderThumbs = await Promise.all(
    renders.map(async (r) => {
      if (!r.output_url) return null;
      const { data } = await admin.storage.from('renders').createSignedUrl(r.output_url, 60 * 60);
      return data?.signedUrl ?? null;
    }),
  );

  // Trends bucket is public, so we can build URLs directly.
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const trendImageUrl = (key: string) =>
    `${supabaseUrl}/storage/v1/object/public/trends/${key}`;

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <span className="text-ink">Dashboard</span>
            <Link href="/projects" className="hover:text-ink">Projects</Link>
            <Link href="/catalogue" className="hover:text-ink">Catalogue</Link>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container space-y-16 py-12 md:py-16">
        {/* ── HERO ────────────────────────────────────────────── */}
        <section>
          <Eyebrow>Welcome back, {firstName}</Eyebrow>
          <DisplayHeading level={1} className="mt-3 max-w-3xl">
            From abstract idea to <em>shopped room</em> in minutes.
          </DisplayHeading>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            myhome is the nexus — your Pinterest inspiration, your room photo, the AU
            retailer catalogue, and AI design intelligence converge here. No more analysis
            paralysis. Pick a direction, see it rendered, click to buy.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/projects/new">
              <Button variant="cta" size="lg">+ Start a project</Button>
            </Link>
            <Link href="/catalogue">
              <Button variant="secondary" size="lg">Browse catalogue</Button>
            </Link>
          </div>
        </section>

        {/* ── INSPIRATION ─────────────────────────────────────── */}
        <section>
          <SectionHead label="Your inspiration" title="Pinterest boards" />
          {pinterestConnected ? (
            <div className="rounded-xl border border-ink/[0.06] bg-cream p-6">
              <p className="font-display text-h4 text-ink">Pinterest connected</p>
              <p className="mt-1 text-[14px] text-ink-soft">
                We've stored a derived style profile from your selected boards. Re-fetch
                anytime to refresh.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-display text-h4 text-ink">Connect Pinterest</p>
                <p className="mt-1 max-w-xl text-[14px] text-ink-soft">
                  Bring in your inspiration boards. We derive a per-board style profile
                  (palette, materials, mood) and use it to ground every render — no pin
                  data is stored, per Pinterest policy.
                </p>
              </div>
              <Link href="/api/pinterest/authorize">
                <Button variant="cta">Connect Pinterest</Button>
              </Link>
            </div>
          )}
        </section>

        {/* ── PROJECTS ─────────────────────────────────────────── */}
        <section>
          <SectionHead
            label="Continue"
            title="Your projects"
            cta={{ href: '/projects', label: 'See all →' }}
          />
          {projects.length === 0 ? (
            <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 text-center">
              <p className="font-display text-h4 text-ink">No projects yet</p>
              <p className="mt-1 text-[14px] text-ink-soft">
                Each project is one room with its own brief, palette, and proposal.
              </p>
              <div className="mt-4">
                <Link href="/projects/new">
                  <Button variant="cta">+ Start your first project</Button>
                </Link>
              </div>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="block h-full rounded-xl border border-ink/[0.06] bg-cream p-5 transition hover:shadow-soft"
                  >
                    <Pill tone={p.status === 'completed' ? 'olive' : 'ink'} size="sm">
                      {p.status.replace('_', ' ')}
                    </Pill>
                    <p className="mt-3 font-display text-h4 text-ink">{p.name}</p>
                    <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      Updated {new Date(p.updated_at).toLocaleDateString('en-AU')}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── TRENDS ──────────────────────────────────────────── */}
        {trends.length > 0 ? (
          <section>
            <SectionHead label="For you" title="Trends to try" />
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {trends.map((t) => {
                const startHref = `/projects/new?palette=${t.palette_id}&room=${t.room_type}`;
                return (
                  <li key={t.id}>
                    <Link
                      href={startHref}
                      className="group block overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft"
                    >
                      <div className="relative aspect-[4/3] w-full bg-paper-warm bg-grain">
                        <Image
                          src={trendImageUrl(t.image_storage_key)}
                          alt={t.headline}
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover transition group-hover:scale-[1.02]"
                          unoptimized
                        />
                      </div>
                      <div className="p-5">
                        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                          {t.palette_name} · {t.room_type.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-2 font-display text-h4 text-ink">{t.headline}</p>
                        <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-ink-soft">
                          {t.description}
                        </p>
                        <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-clay group-hover:underline">
                          Try this look →
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* ── CATALOGUE STRIP ─────────────────────────────────── */}
        <section>
          <SectionHead
            label="Browse"
            title="The AU catalogue"
            cta={{ href: '/catalogue', label: 'Open browser →' }}
          />
          {products.length === 0 ? (
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Catalogue is empty — run the scraper + ingest first.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/catalogue?retailer=${encodeURIComponent(p.retailer)}`}
                    className="group block overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft"
                  >
                    <div className="relative aspect-square w-full bg-paper-warm bg-grain">
                      <Image
                        src={p.image_url}
                        alt={p.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 25vw"
                        className="object-cover transition group-hover:scale-[1.02]"
                        unoptimized
                      />
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 font-display text-[14px] leading-tight text-ink">
                        {p.name}
                      </p>
                      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        {p.retailer}
                      </p>
                      <p className="mt-1 font-display text-h4 text-ink">
                        {p.price_aud != null
                          ? `$${Math.round(p.price_aud).toLocaleString('en-AU')}`
                          : 'POA'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── PALETTE OVERVIEW ────────────────────────────────── */}
        <section>
          <SectionHead label="2026 directions" title="Curated AU palettes" />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {listPalettes().slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/new?palette=${p.id}`}
                  className="block h-full rounded-xl border border-ink/[0.06] bg-cream p-5 transition hover:shadow-soft"
                >
                  <PaletteStrip colors={paletteSwatch(p)} className="h-7" />
                  <p className="mt-3 font-display text-h4 text-ink">{p.name}</p>
                  <p className="mt-1 text-[13px] text-ink-soft">{p.vibe}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── RECENT RENDERS ──────────────────────────────────── */}
        {renders.length > 0 ? (
          <section>
            <SectionHead label="Activity" title="Recent renders" />
            <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {renders.map((r, i) => (
                <li key={r.id}>
                  <Link
                    href={`/renders/${r.id}`}
                    className="group block overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft"
                  >
                    <div className="relative aspect-square w-full bg-paper-warm bg-grain">
                      {renderThumbs[i] ? (
                        <Image
                          src={renderThumbs[i] as string}
                          alt="Render"
                          fill
                          sizes="(max-width: 768px) 50vw, 16vw"
                          className="object-cover transition group-hover:scale-[1.02]"
                          unoptimized
                        />
                      ) : (
                        <div className="grid h-full place-items-center">
                          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                            {r.status}
                          </p>
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

function SectionHead({
  label,
  title,
  cta,
}: {
  label: string;
  title: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Eyebrow>{label}</Eyebrow>
        <p className="mt-2 font-display text-h3 text-ink">{title}</p>
      </div>
      {cta ? (
        <Link
          href={cta.href}
          className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
