import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmailAuthFormEditorial } from '@/components/auth/email-auth-form-editorial';
import { GoogleAuthButtonEditorial } from '@/components/auth/google-auth-button-editorial';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// Sign-in surface, myMaison editorial brand. Cream paper, espresso ink,
// Playfair display, cognac accents. Wordmark and chrome are intentionally
// quiet — the auth card does the talking.
export default async function LoginPage({
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

      <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-6xl items-center px-6 py-12">
        <div className="mx-auto w-full max-w-md">
          <p className="font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe">
            Sign in · 02
          </p>
          <h1 className="mt-3 font-serif text-[clamp(32px,4vw,44px)] font-normal leading-[1.05] text-editorial-ink">
            Welcome <em className="italic text-editorial-cognac">back</em>.
          </h1>
          <p className="mt-3 max-w-sm font-dmsans text-[15px] leading-relaxed text-editorial-taupe">
            Pick up where you left off — your renders, palettes and saved rooms
            are waiting.
          </p>

          <div className="mt-8 rounded-2xl border border-editorial-border bg-editorial-surface p-7 shadow-soft">
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
              <EmailAuthFormEditorial mode="signin" next={params.next} />
              {params.error ? (
                <p className="rounded-md border border-editorial-cognac/40 bg-editorial-cognac/10 px-3 py-2 font-dmsans text-[13px] text-editorial-ink">
                  {params.error}
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-6 text-center font-dmsans text-[14px] text-editorial-taupe">
            No account yet?{' '}
            <Link
              href={`/signup${params.next ? `?next=${encodeURIComponent(params.next)}` : ''}`}
              className="text-editorial-cognac underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

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
        to enable sign-in.
      </p>
    </div>
  );
}
