import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { SortSelect } from '@/components/catalogue/sort-select';
import { AddToProjectButton } from '@/components/projects/add-to-project-button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  'Sofas',
  'Chairs',
  'Coffee Tables',
  'Side Tables',
  'Dining',
  'Beds',
  'Lighting',
  'Rugs',
  'Ottomans',
  'Sideboards',
];

const RETAILERS = ['Coco Republic', 'Poliform', 'GlobeWest'];

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
}

interface SearchParams {
  category?: string;
  retailer?: string;
  sort?: string;
}

const PAGE_SIZE = 36;

export default async function CataloguePage({
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
  if (!user) redirect('/login?next=/catalogue');

  const sort = params.sort ?? 'price_desc';
  let query = supabase
    .from('products')
    .select('id, name, retailer, category, price_aud, image_url, product_url')
    .not('image_url', 'is', null)
    .limit(PAGE_SIZE);

  if (params.category) query = query.eq('category', params.category);
  if (params.retailer) query = query.eq('retailer', params.retailer);

  if (sort === 'price_asc') {
    query = query.order('price_aud', { ascending: true, nullsFirst: false });
  } else if (sort === 'price_desc') {
    query = query.order('price_aud', { ascending: false, nullsFirst: false });
  } else if (sort === 'name') {
    query = query.order('name');
  }

  const res = await query;
  const products = (res.data as ProductRow[] | null) ?? [];

  // Counts per category for the filter chips.
  const allRes = await supabase
    .from('products')
    .select('category')
    .not('image_url', 'is', null);
  const allRows = (allRes.data as { category: string }[] | null) ?? [];
  const counts: Record<string, number> = {};
  for (const r of allRows) counts[r.category] = (counts[r.category] ?? 0) + 1;

  function buildHref(next: Partial<SearchParams>) {
    const merged: SearchParams = { ...params, ...next };
    Object.keys(merged).forEach((k) => {
      if (!merged[k as keyof SearchParams]) delete merged[k as keyof SearchParams];
    });
    const qs = new URLSearchParams(merged as Record<string, string>).toString();
    return `/catalogue${qs ? `?${qs}` : ''}`;
  }

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
            <Link href="/projects" className="hover:text-ink">Projects</Link>
            <span className="text-ink">Catalogue</span>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container py-10 md:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Browse</Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              The <em>AU catalogue</em>.
            </DisplayHeading>
            <p className="mt-3 max-w-2xl text-[15px] text-ink-soft">
              {allRows.length} products across {RETAILERS.length} Australian retailers.
              Filter and click any item to stage it in your room or add to a project.
            </p>
          </div>
          <SortSelect value={sort} />
        </div>

        {/* Filter chips */}
        <div className="mb-8 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Category ·
            </span>
            <Link
              href={buildHref({ category: undefined })}
              className={chipClass(!params.category)}
            >
              All ({allRows.length})
            </Link>
            {CATEGORIES.map((c) => {
              const count = counts[c] ?? 0;
              if (count === 0) return null;
              return (
                <Link
                  key={c}
                  href={buildHref({ category: c })}
                  className={chipClass(params.category === c)}
                >
                  {c} ({count})
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Retailer ·
            </span>
            <Link
              href={buildHref({ retailer: undefined })}
              className={chipClass(!params.retailer)}
            >
              All
            </Link>
            {RETAILERS.map((r) => (
              <Link
                key={r}
                href={buildHref({ retailer: r })}
                className={chipClass(params.retailer === r)}
              >
                {r}
              </Link>
            ))}
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-12 text-center">
            <p className="font-display text-h3 text-ink">No products match those filters.</p>
            <p className="mt-2 text-[14px] text-ink-soft">
              Try removing one of the filters or pick a different category.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <li key={p.id}>
                {/* Card wraps the image + details in a single retailer
                    link, with the AddToProjectButton (#130) sitting
                    OUTSIDE the anchor so clicking it doesn't fire the
                    retailer navigation. */}
                <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft">
                  <a
                    href={p.product_url}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="block"
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
                    <div className="space-y-2 p-4">
                      <Pill tone="cream" size="sm">{p.category}</Pill>
                      <p className="line-clamp-2 font-display text-[15px] leading-tight text-ink">
                        {p.name}
                      </p>
                      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        {p.retailer}
                      </p>
                      <p className="font-display text-h4 text-ink">
                        {p.price_aud != null
                          ? `$${Math.round(p.price_aud).toLocaleString('en-AU')}`
                          : 'POA'}
                      </p>
                      <p className="font-mono text-meta uppercase tracking-eyebrow text-clay group-hover:underline">
                        View at {p.retailer} ↗
                      </p>
                    </div>
                  </a>
                  <div className="mt-auto border-t border-ink/[0.06] p-3">
                    <AddToProjectButton productId={p.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-12 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {products.length} of {allRows.length} products shown · paginated lists land next iteration
        </p>
      </main>
    </>
  );
}

function chipClass(active: boolean): string {
  return [
    'rounded-pill px-4 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
    active ? 'bg-ink text-paper' : 'border border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
  ].join(' ');
}
