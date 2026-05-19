import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmailAuthFormEditorial } from '@/components/auth/email-auth-form-editorial';
import { GoogleAuthButtonEditorial } from '@/components/auth/google-auth-button-editorial';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// Account creation surface, myMaison editorial brand.
//
// During closed beta (the default), sign-ups are *paused* — we render a
// request-access state instead of the form. The real lock is enforced at
// the Supabase Auth level (Authentication → Providers → Allow new users to
// sign up = OFF); this flag just keeps the UI honest with the server state.
// To reopen sign-ups: set NEXT_PUBLIC_SIGNUPS_OPEN=true in Vercel AND
// re-enable the Supabase setting. See docs/OVERVIEW.md §2.5 + §7.3.
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === 'true';

// Replace this with your real beta-access mailbox when ready.
const REQUEST_ACCESS_EMAIL = 'hello@mymaison.com.au';

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

      {SIGNUPS_OPEN ? (
        <OpenSignup params={params} />
      ) : (
        <ClosedBeta params={params} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Closed-beta state — what /signup shows by default during the cohort.
// Quiet, editorial, and clearly directs existing users to /login and
// new requesters to email.
// ──────────────────────────────────────────────────────────────────────
function ClosedBeta({ params }: { params: { next?: string } }) {
  const subject = encodeURIComponent('myMaison closed beta — access request');
  const body = encodeURIComponent(
    'Hi — please add me to the closed beta. One line on the room I want to restyle:\n\n',
  );
  const mailto = `mailto:${REQUEST_ACCESS_EMAIL}?subject=${subject}&body=${body}`;
  const loginHref = `/login${params.next ? `?next=${encodeURIComponent(params.next)}` : ''}`;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-6xl items-center px-6 py-12">
      <div className="mx-auto w-full max-w-xl text-center">
        <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
          Closed beta
        </p>
        <h1 className="mt-3 font-serif text-[clamp(34px,4.6vw,52px)] font-normal leading-[1.02] text-editorial-ink">
          We&rsquo;re in <em className="italic text-editorial-cognac">closed</em> beta.
        </h1>
        <p className="mx-auto mt-5 max-w-md font-dmsans text-[15px] leading-relaxed text-editorial-taupe">
          Sign-ups are paused while we onboard our first cohort of homeowners,
          design studios and retailers. If you already have a myMaison
          account, sign in below. To request access, drop us a line.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={loginHref}
            className="rounded-full bg-editorial-ink px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-cream transition hover:opacity-90"
          >
            Sign in
          </Link>
          <a
            href={mailto}
            className="rounded-full border border-editorial-borderStrong bg-editorial-surface px-6 py-3 font-dmsans text-[14px] font-medium text-editorial-ink transition hover:border-editorial-cognac hover:text-editorial-cognac"
          >
            Request access ↗
          </a>
        </div>

        <ul className="mx-auto mt-12 grid max-w-lg gap-4 text-left">
          {COHORT_NOTES.map((n) => (
            <li
              key={n.title}
              className="flex items-start gap-3 rounded-2xl border border-editorial-border bg-editorial-surface p-5"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-editorial-border bg-editorial-cream font-dmmono text-[10px] font-medium text-editorial-cognac"
              >
                {n.n}
              </span>
              <div>
                <p className="font-serif text-[15px] leading-tight text-editorial-ink">
                  {n.title}
                </p>
                <p className="mt-1 font-dmsans text-[13px] leading-relaxed text-editorial-taupe">
                  {n.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-10 font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
          Three audiences · twenty in the first cohort · open beta soon
        </p>
      </div>
    </main>
  );
}

const COHORT_NOTES: { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'Homeowners',
    body: 'We want a mix of suburbs, room types and aesthetics so the trend generator stays representative.',
  },
  {
    n: '02',
    title: 'Design studios',
    body: 'Five studios — solo, mid-size, larger — testing the proposal and clients tooling before the paid plan opens.',
  },
  {
    n: '03',
    title: 'Retailers',
    body: 'Three retail partners onboarding their catalogue while we collect honest conversion data.',
  },
];

// ──────────────────────────────────────────────────────────────────────
// Live sign-up form. Only rendered when SIGNUPS_OPEN is true AND the
// Supabase backend has signups enabled. (If only one is true, Supabase
// rejects sign-up attempts server-side anyway — fail closed.)
// ──────────────────────────────────────────────────────────────────────
function OpenSignup({ params }: { params: { next?: string; error?: string } }) {
  return (
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
          designer&rsquo;s read on why it works.
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
