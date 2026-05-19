import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmailAuthFormEditorial } from '@/components/auth/email-auth-form-editorial';
import { GoogleAuthButtonEditorial } from '@/components/auth/google-auth-button-editorial';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// Account creation surface, myMaison editorial brand. Mirrors /login with
// a marketing-leaning lede: what they get on free, what comes next. The
// chrome stays quiet so the proposition reads first.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(params.next ?? '/dashboard');
  }

  return (
    <div className="min-h-screen bg-editorial-cream font-dmsans text-editorial-ink">
      <header className="border-b border-editorial-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="font-serif text-[24px] tracking-tight">
              <span className="italic font-normal text-editorial-taupe">my</span>
              <span className="font-medium text-editorial-ink">Maison</span>
            </span>
            <span className="rounded-full bg-editorial-cognac/15 px-1.5 py-0.5 font-dmmono text-[9px] uppercase tracking-[0.14em] text-editorial-cognac">
              Beta
            </span>
          </Link>
          <Link
            href="/"
            className="font-dmsans text-[13px] font-medium text-editorial-taupe transition hover:text-editorial-ink"
          >
            ← Back home
          </Link>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-65px)] max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1fr_minmax(380px,420px)]">
        <aside className="hidden lg:block">
          <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
            Create account · 01
          </p>
          <h1 className="mt-3 font-serif text-[clamp(32px,4.4vw,52px)] font-normal leading-[1.02] text-editorial-ink">
            Restyle any room.{' '}
            <em className="italic text-editorial-cognac">Shop</em> the look.
          </h1>
          <p className="mt-5 max-w-md font-dmsans text-[15px] leading-relaxed text-editorial-taupe">
            myMaison turns your room photo into a fully shopped restyle — real
            products from real Australian retailers, sized to your space, with a
            designer's read on why it works.
          </p>

          <ul className="mt-8 space-y-4">
            {SIGNUP_HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-editorial-border bg-editorial-surface font-dmmono text-[10px] font-medium text-editorial-cognac"
                >
                  {h.n}
                </span>
                <div>
                  <p className="font-serif text-[16px] leading-tight text-editorial-ink">
                    {h.title}
                  </p>
                  <p className="mt-1 font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
                    {h.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-10 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
            Free to try · three renders · no card
          </p>
        </aside>

        <div className="w-full max-w-md lg:justify-self-end">
          <div className="lg:hidden">
            <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
              Create account · 01
            </p>
            <h1 className="mt-3 font-serif text-[clamp(30px,4vw,40px)] font-normal leading-[1.05] text-editorial-ink">
              Restyle any room.{' '}
              <em className="italic text-editorial-cognac">Shop</em> the look.
            </h1>
            <p className="mt-3 max-w-sm font-dmsans text-[15px] leading-relaxed text-editorial-taupe">
              Free to try. Three renders included. No card.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-editorial-border bg-editorial-surface p-7 shadow-soft lg:mt-0">
            {!isSupabaseConfigured ? <NotConfiguredNotice /> : null}
            <div className="space-y-5">
              <GoogleAuthButtonEditorial next={params.next} />
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-editorial-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-editorial-surface px-3 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
                    or with email
                  </span>
                </div>
              </div>
              <EmailAuthFormEditorial mode="signup" next={params.next} />
              {params.error ? (
                <p className="rounded-md border border-editorial-cognac/40 bg-editorial-cognac/10 px-3 py-2 font-dmsans text-[13px] text-editorial-ink">
                  {params.error}
                </p>
              ) : null}
              <p className="font-dmsans text-[12px] leading-relaxed text-editorial-taupe">
                By creating an account you agree to our{' '}
                <Link
                  href="/legal/terms"
                  className="text-editorial-cognac underline-offset-4 hover:underline"
                >
                  terms
                </Link>{' '}
                and{' '}
                <Link
                  href="/legal/privacy"
                  className="text-editorial-cognac underline-offset-4 hover:underline"
                >
                  privacy notice
                </Link>
                . Affiliate links are disclosed in line with ACCC guidance.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center font-dmsans text-[14px] text-editorial-taupe">
            Already have one?{' '}
            <Link
              href={`/login${params.next ? `?next=${encodeURIComponent(params.next)}` : ''}`}
              className="text-editorial-cognac underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

const SIGNUP_HIGHLIGHTS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Snap your room',
    body: 'Phone photo is enough. We analyse the architecture before we touch a pixel.',
  },
  {
    n: '2',
    title: 'Pick a palette',
    body: 'Curated 2026 directions from Dulux, S-W and Pantone — set the mood in one tap.',
  },
  {
    n: '3',
    title: 'Shop the render',
    body: 'Tap a chair, place it in your room, see the price. Real retailers — Coco Republic, Poliform, GlobeWest.',
  },
];

function NotConfiguredNotice() {
  return (
    <div className="mb-5 rounded-md border-l-2 border-editorial-cognac bg-editorial-cognac/10 p-4 font-dmsans text-[13px] leading-relaxed text-editorial-ink">
      <p className="font-medium">Supabase isn't configured yet.</p>
      <p className="mt-1 text-editorial-taupe">
        Add{' '}
        <code className="rounded bg-editorial-cream px-1 py-0.5 font-dmmono text-[11px]">
          NEXT_PUBLIC_SUPABASE_URL
        </code>{' '}
        and{' '}
        <code className="rounded bg-editorial-cream px-1 py-0.5 font-dmmono text-[11px]">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{' '}
        to{' '}
        <code className="rounded bg-editorial-cream px-1 py-0.5 font-dmmono text-[11px]">
          apps/web/.env.local
        </code>{' '}
        to enable sign-up.
      </p>
    </div>
  );
}
