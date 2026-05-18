import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-ink/[0.06] bg-paper/85 backdrop-blur">
        <div className="container flex items-center justify-between py-6">
          <Logo size="md" />
          <nav className="hidden gap-9 text-[14px] text-ink-soft md:flex">
            <Link href="#how" className="transition-colors hover:text-clay">
              How it works
            </Link>
            <Link href="#styles" className="transition-colors hover:text-clay">
              Styles
            </Link>
            <Link href="#retailers" className="transition-colors hover:text-clay">
              Retailers
            </Link>
            <Link href="#journal" className="transition-colors hover:text-clay">
              Journal
            </Link>
          </nav>
          <Button asChild variant="primary" size="sm">
            <Link href="/signup">Start free</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="container grid items-center gap-16 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        <div>
          <Eyebrow>An Australian styling studio · in your camera roll</Eyebrow>
          <DisplayHeading level={1} className="mt-7">
            Your room, styled like a <em>magazine</em>.
          </DisplayHeading>
          <p className="mt-7 max-w-[480px] text-[18px] leading-relaxed text-ink-soft">
            Take a photo of your living room. Pick a style — or connect your Pinterest. We give you
            back a photorealistic restyle where every piece is a real product from an Australian
            retailer.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Button asChild variant="cta" size="lg">
              <Link href="/signup">
                Style my room
              </Link>
            </Button>
            <Link
              href="#how"
              className="inline-flex items-center gap-2 text-[14px] text-ink-soft underline-offset-4 hover:text-clay hover:underline"
            >
              See how it works
              <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
            </Link>
          </div>
          <p className="mt-6 font-mono text-[12px] uppercase tracking-eyebrow text-ink-faint">
            Free to try · 3 renders included · No card required
          </p>
        </div>

        {/* Hero visual — gradient placeholders; replace with real photography */}
        <div className="relative aspect-[4/5] w-full">
          <div
            aria-hidden
            className="absolute inset-[8%_30%_14%_0] -rotate-3 overflow-hidden rounded-lg shadow-soft"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(0,0,0,0.2)), linear-gradient(135deg, #c4b8a3, #9a8f7b)',
            }}
          >
            <span className="absolute bottom-3.5 left-4 font-mono text-[10px] uppercase tracking-eyebrow text-cream/90">
              Before · Living room, Northcote
            </span>
          </div>
          <div
            aria-hidden
            className="absolute inset-[18%_0_0_28%] rotate-2 overflow-hidden rounded-lg shadow-soft"
            style={{
              background:
                'linear-gradient(160deg, rgba(255,238,210,0.4), rgba(0,0,0,0.25)), linear-gradient(135deg, #b8956f, #7a5d3f)',
            }}
          >
            <span className="absolute bottom-3.5 left-4 font-mono text-[10px] uppercase tracking-eyebrow text-cream">
              After · Warm Japandi
            </span>
          </div>
          <div className="absolute right-[4%] top-[38%]">
            <Pill withDot>
              Aurora sofa <span className="font-mono text-[10px] text-ink-soft">$2,199</span>
            </Pill>
          </div>
          <div className="absolute left-[32%] top-[68%]">
            <Pill withDot>
              Oak side table <span className="font-mono text-[10px] text-ink-soft">$849</span>
            </Pill>
          </div>
        </div>
      </section>

      {/* Retailer strip */}
      <section id="retailers" className="border-y border-ink/[0.06] bg-paper-warm">
        <div className="container flex flex-wrap items-center gap-14 py-10">
          <p className="max-w-[160px] font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Stocked from
          </p>
          <div className="flex flex-1 flex-wrap items-center gap-12 text-ink-soft">
            <span className="font-display text-[19px] tracking-wide">Temple &amp; Webster</span>
            <span className="font-display text-[19px] italic">Castlery</span>
            <span className="font-display text-[19px]">Freedom</span>
            <span className="font-display text-[14px] font-medium uppercase tracking-[0.18em]">
              IKEA AU
            </span>
            <span className="font-display text-[19px]">Coco Republic</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="container py-24 lg:py-28">
        <Eyebrow>How it works</Eyebrow>
        <DisplayHeading level={2} className="mt-4 max-w-[720px]">
          Three steps from <em>photo</em> to picking list.
        </DisplayHeading>
        <div className="mt-16 grid gap-12 md:grid-cols-3">
          {[
            {
              n: '01',
              t: 'Snap your room',
              d: 'Daylight, wide angle, all four walls in shot. We do the rest — depth, geometry, lighting.',
            },
            {
              n: '02',
              t: 'Pick or import a style',
              d: 'Start with one of eight curated Australian aesthetics, or connect your Pinterest and let us read your taste.',
            },
            {
              n: '03',
              t: 'Shop the look',
              d: 'Every visible piece maps to a real, in-stock product from an AU retailer. Prices in AUD, GST inclusive.',
            },
          ].map((s) => (
            <div key={s.n}>
              <span className="font-display text-[56px] italic font-light leading-none text-clay">
                {s.n}
              </span>
              <div className="mb-6 mt-5 h-px w-14 bg-ink/12" />
              <h3 className="mb-3 font-display text-2xl font-normal tracking-tight text-ink">
                {s.t}
              </h3>
              <p className="text-[15px] leading-relaxed text-ink-soft">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quote */}
      <section className="border-t border-ink/[0.06] bg-paper-warm">
        <div className="container py-24 lg:py-28">
          <blockquote className="mx-auto max-w-[900px] text-center font-display text-[clamp(28px,3.4vw,38px)] font-light italic leading-tight tracking-tight">
            “It read my Pinterest board better than my partner does. The sofa it suggested is
            currently in our living room.”
          </blockquote>
          <p className="mt-8 text-center font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            <strong className="font-medium text-clay">Maya R.</strong> · Northcote, VIC · beta tester
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink/12">
        <div className="container flex flex-col items-start justify-between gap-3 py-10 font-mono text-meta uppercase tracking-[0.1em] text-ink-faint md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} saltbush · made in AU</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-clay">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-clay">
              Terms
            </Link>
            <Link href="/design-system" className="hover:text-clay">
              Design system
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
