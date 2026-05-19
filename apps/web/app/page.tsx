import Link from 'next/link';

// Public landing page. Editorial-luxury treatment per the myMaison brand
// guidelines: Playfair Display headlines, DM Sans body, DM Mono metadata,
// warm cream surfaces, espresso ink, cognac accents. Sentence case
// throughout — never Title Case.

const RETAILERS = [
  { name: 'Coco Republic', tagline: 'Considered AU heritage' },
  { name: 'Poliform', tagline: 'Italian milled luxury' },
  { name: 'GlobeWest', tagline: 'Designer-trade favourites' },
  { name: 'Freedom', tagline: 'Coming soon' },
  { name: 'Bunnings', tagline: 'Paint · finishes · coming soon' },
];

const STEPS = [
  {
    n: '01',
    t: 'Take a photo of your room',
    d: 'Daylight works best. We read the dimensions, the light, the existing materials, and the architecture — and lock them so the restyle stays your room.',
  },
  {
    n: '02',
    t: 'Choose a direction',
    d: 'Eight curated Australian aesthetics, ten 2026 palettes, or connect your Pinterest. The designer LLM grounds every choice in real AU climate and building stock.',
  },
  {
    n: '03',
    t: 'Render, refine, shop',
    d: 'A photorealistic restyle in under a minute. Every visible piece maps to a real product from an AU retailer with price, dimensions, and a buy link.',
  },
];

const NEXUS_STEPS = [
  { label: 'Inspiration absorbed' },
  { label: 'Room analysed' },
  { label: 'Products matched' },
  { label: 'Rendered in your room' },
  { label: 'Shopped & quoted' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-editorial-cream font-dmsans text-editorial-ink">
      {/* Nav */}
      <header className="sticky top-0 z-30 h-[64px] border-b border-editorial-border bg-editorial-cream/85 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="myMaison — home">
            <span className="font-serif text-[22px] leading-none">
              <span className="italic font-normal text-editorial-taupe">my</span>
              <span className="font-medium text-editorial-ink">Maison</span>
            </span>
            <span className="rounded-full bg-editorial-cognac/15 px-1.5 py-0.5 font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-cognac">
              Beta
            </span>
          </Link>
          <nav className="hidden gap-7 md:flex">
            <Link
              href="#how"
              className="font-dmsans text-[13px] font-medium text-editorial-taupe transition hover:text-editorial-ink"
            >
              How it works
            </Link>
            <Link
              href="#retailers"
              className="font-dmsans text-[13px] font-medium text-editorial-taupe transition hover:text-editorial-ink"
            >
              Retailers
            </Link>
            <Link
              href="#nexus"
              className="font-dmsans text-[13px] font-medium text-editorial-taupe transition hover:text-editorial-ink"
            >
              The nexus
            </Link>
            <Link
              href="/login"
              className="font-dmsans text-[13px] font-medium text-editorial-taupe transition hover:text-editorial-ink"
            >
              Sign in
            </Link>
          </nav>
          <Link
            href="/signup"
            className="rounded-full bg-editorial-ink px-4 py-2 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1200px] px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <p className="font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
          Your personal design studio · Australia
        </p>
        <h1 className="mt-5 max-w-3xl font-serif text-[clamp(38px,6vw,72px)] font-normal leading-[1.02] text-editorial-ink">
          From inspiration to a <em className="italic">fully shopped room</em> — in minutes.
        </h1>
        <p className="mt-6 max-w-2xl font-dmsans text-[16px] leading-relaxed text-editorial-taupe">
          myMaison is the nexus between your Pinterest board, your actual room photo, the
          Australian retailer catalogue, and a senior-designer-grade AI. Pick a direction. See
          your room rendered with real, buyable products. Walk past analysis paralysis straight
          to a quote.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            href="/signup"
            className="rounded-full bg-editorial-cognac px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-ink transition hover:opacity-90"
          >
            Style my room
          </Link>
          <Link
            href="#how"
            className="font-dmsans text-[14px] font-medium text-editorial-taupe underline-offset-4 transition hover:text-editorial-ink hover:underline"
          >
            See how it works →
          </Link>
        </div>
        <p className="mt-6 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
          Free for individuals · three renders included · no card required
        </p>
      </section>

      {/* Retailer strip */}
      <section
        id="retailers"
        className="border-y border-editorial-border bg-editorial-surface"
      >
        <div className="mx-auto max-w-[1200px] px-6 py-12">
          <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
            Stocked from a curated AU catalogue
          </p>
          <ul className="mt-6 grid gap-6 md:grid-cols-5">
            {RETAILERS.map((r) => (
              <li
                key={r.name}
                className="flex flex-col gap-1 rounded-xl border border-editorial-border bg-editorial-cream p-4"
              >
                <p className="font-serif text-[17px] leading-tight text-editorial-ink">{r.name}</p>
                <p className="font-dmsans text-[12px] text-editorial-taupe">{r.tagline}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
            We're building toward 500+ Australian SKUs across furniture, lighting, decor, and
            paint — so every visible piece in your render maps to something you can actually buy
            today.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <p className="font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
          How it works
        </p>
        <h2 className="mt-4 max-w-3xl font-serif text-[clamp(28px,3vw,42px)] font-medium leading-[1.1] text-editorial-ink">
          Three steps from <em className="italic">photo</em> to picking list.
        </h2>
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="font-serif text-[64px] italic font-normal leading-none text-editorial-cognac">
                {s.n}
              </span>
              <div className="my-5 h-px w-12 bg-editorial-border" />
              <h3 className="font-serif text-[20px] font-medium leading-tight text-editorial-ink">
                {s.t}
              </h3>
              <p className="mt-3 font-dmsans text-[14px] leading-relaxed text-editorial-taupe">
                {s.d}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* The nexus */}
      <section id="nexus" className="bg-editorial-ink py-20 text-editorial-cream md:py-28">
        <div className="mx-auto max-w-[1100px] px-6">
          <p className="font-dmmono text-[11px] uppercase tracking-[0.16em] text-editorial-cognac">
            The myMaison nexus
          </p>
          <h2 className="mt-4 max-w-3xl font-serif text-[clamp(28px,3.2vw,46px)] font-medium leading-[1.1] text-editorial-cream">
            Abstract idea → <em className="italic">fully shopped room</em>.
          </h2>
          <p className="mt-5 max-w-2xl font-dmsans text-[15px] leading-relaxed text-editorial-cream/70">
            Pinterest aesthetic, Claude vision, fal Flux generation, Australian retailer
            catalogue, and a designer LLM read — all converge into one pipeline. You move from
            intent to a decision in minutes, not weekends. Designers can take a brief from client
            address to PDF proposal in the same evening.
          </p>
          <ol className="mt-12 grid gap-3 md:grid-cols-5">
            {NEXUS_STEPS.map((s, i) => (
              <li
                key={s.label}
                className="rounded-2xl border border-editorial-cream/15 bg-editorial-ink/40 p-4 text-editorial-cream/80"
              >
                <p className="font-dmmono text-[10px] uppercase tracking-[0.12em] text-editorial-cognac">
                  {`0${i + 1}`}
                </p>
                <p className="mt-3 font-serif text-[15px] leading-tight text-editorial-cream">
                  {s.label}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-full bg-editorial-cognac px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-ink transition hover:opacity-90"
            >
              Start your first project
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-editorial-cream/40 px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-cream transition hover:bg-editorial-cream/10"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Two-up: individual vs studio */}
      <section className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <p className="font-dmmono text-[11px] uppercase tracking-[0.14em] text-editorial-taupe">
          Two ways in
        </p>
        <h2 className="mt-4 max-w-2xl font-serif text-[clamp(26px,2.8vw,38px)] font-medium leading-[1.1] text-editorial-ink">
          Style your home. Or your <em className="italic">clients'</em> homes.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-editorial-border bg-editorial-surface p-8">
            <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
              Individual · free
            </p>
            <p className="mt-3 font-serif text-[22px] font-medium leading-tight text-editorial-ink">
              My own home.
            </p>
            <p className="mt-3 font-dmsans text-[14px] leading-relaxed text-editorial-taupe">
              For homeowners. Three renders to start, all the catalogue + designer reads + virtual
              staging. Free forever.
            </p>
            <Link
              href="/signup?type=individual"
              className="mt-6 inline-block rounded-full bg-editorial-ink px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-cream transition hover:opacity-90"
            >
              Sign up free
            </Link>
          </div>
          <div className="rounded-2xl border border-editorial-cognac/40 bg-editorial-surface p-8">
            <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-cognac">
              Design studio · paid plan
            </p>
            <p className="mt-3 font-serif text-[22px] font-medium leading-tight text-editorial-ink">
              Client work, end-to-end.
            </p>
            <p className="mt-3 font-dmsans text-[14px] leading-relaxed text-editorial-taupe">
              Manage multiple clients with their own addresses, render their rooms, generate a
              myMaison-branded PDF proposal with cost breakdown — all from one place.
            </p>
            <Link
              href="/signup?type=studio"
              className="mt-6 inline-block rounded-full bg-editorial-cognac px-5 py-2.5 font-dmsans text-[13px] font-medium text-editorial-ink transition hover:opacity-90"
            >
              Talk to us about studio access
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-editorial-border">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-3 px-6 py-10 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} myMaison · made in Australia</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-editorial-ink">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-editorial-ink">
              Terms
            </Link>
            <Link href="/dashboard" className="hover:text-editorial-ink">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
