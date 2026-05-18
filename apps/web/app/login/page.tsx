import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmailAuthForm } from '@/components/auth/email-auth-form';
import { GoogleAuthButton } from '@/components/auth/google-auth-button';
import { SupabaseNotConfigured } from '@/components/supabase-not-configured';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function LoginPage({
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
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your myHome account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isSupabaseConfigured ? <SupabaseNotConfigured /> : null}
          <GoogleAuthButton next={searchParams.next} />
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or with email</span>
            </div>
          </div>
          <EmailAuthForm mode="signin" next={searchParams.next} />
          {searchParams.error ? (
            <p className="text-sm text-destructive">{searchParams.error}</p>
          ) : null}
          <p className="text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link className="underline" href="/signup">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
