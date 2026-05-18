import Link from 'next/link';
import { SectionHeader } from '@/components/dashboard/shared/section-header';
import { Tag } from '@/components/dashboard/shared/tag';

interface BoardCard {
  id: string;
  name: string;
  pinCount: number;
  styleTags: string[];
  accentHex: string; // tint used for the hover background
}

interface PinterestSectionProps {
  connected: boolean;
  boards: BoardCard[]; // empty when not connected
}

// Pinterest boards strip. When Phase 2 OAuth lands we'll populate boards
// with real data; until then we show the connect CTA + placeholder grid.
export function PinterestSection({ connected, boards }: PinterestSectionProps) {
  return (
    <section id="pinterest" className="py-10">
      <SectionHeader
        title="Your Pinterest boards"
        action={
          connected
            ? { label: 'Reconnect Pinterest →', href: '/api/pinterest/authorize' }
            : { label: 'Why we ask →', href: '/privacy#pinterest' }
        }
      />

      {!connected ? (
        <div className="grid gap-6 rounded-2xl border border-editorial-border bg-editorial-surface p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="font-serif text-[20px] leading-snug text-editorial-ink">
              Connect Pinterest to anchor your aesthetic.
            </p>
            <p className="mt-2 max-w-xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
              We read the boards you choose, derive a style profile (palette, materials, mood),
              and never store your pins. The derived signal grounds every render.
            </p>
          </div>
          <Link
            href="/api/pinterest/authorize"
            className="self-start rounded-full bg-editorial-ink px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            Connect Pinterest
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`/projects/new?board=${b.id}`}
                className="group block h-full overflow-hidden rounded-xl border border-editorial-border bg-editorial-surface transition hover:border-editorial-borderStrong"
              >
                <div
                  aria-hidden
                  className="aspect-[4/3] w-full transition-colors duration-200"
                  style={{ background: b.accentHex }}
                />
                <div className="p-4">
                  <p className="font-serif text-[17px] leading-tight text-editorial-ink">
                    {b.name}
                  </p>
                  <p className="mt-1 font-dmmono text-[10px] uppercase tracking-[0.1em] text-editorial-taupe">
                    {b.pinCount} pins
                  </p>
                  {b.styleTags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {b.styleTags.slice(0, 2).map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
