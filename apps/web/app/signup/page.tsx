import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { EmailAuthForm } from '@/components/auth/email-auth-form';
import { GoogleAuthButton } from '@/components/auth/google-auth-button';
import { SupabaseNotConfigured } from '@/components/supabase-not-configured';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  if (isSupabaseConfigured) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(searchParams.next ?? '/dashboard');
  }

  return (
    <main className="container flex min-h-screen items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-lg border border-ink/[0.06] bg-cream p-8 shadow-soft">
          <Eyebrow>Get started · 01</Eyebrow>
          <DisplayHeading level={3} className="mt-2">
            Restyle any room, <em>shop</em> the look.
          </DisplayHeading>
          <p className="mt-3 text-[15px] text-ink-soft">
            Free to try. Three renders included. No card.
          </p>

          <div className="mt-7 space-y-5">
            {!isSupabaseConfigured ? <SupabaseNotConfigured /> : null}
            <GoogleAuthButton next={searchParams.next} />
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-ink/[0.06]" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-cream px-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  or with email
                </span>
              </div>
            </div>
            <EmailAuthForm mode="signup" next={searchParams.next} />
            {searchParams.error ? (
              <p className="text-[13px] text-destructive">{searchParams.error}</p>
            ) : null}
          </div>
        </div>
        <p className="mt-6 text-center text-[14px] text-ink-soft">
          Already have one?{' '}
          <Link href="/login" className="text-clay underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
