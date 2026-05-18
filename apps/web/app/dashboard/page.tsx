import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  if (!isSupabaseConfigured) {
    redirect('/login');
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const firstName = user.email?.split('@')[0] ?? 'there';

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <span className="text-ink">My rooms</span>
            <span>Saved products</span>
            <span>Style profile</span>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container py-16">
        <div className="mb-12 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Eyebrow>Welcome back, {firstName}</Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              Your <em>rooms</em>.
            </DisplayHeading>
          </div>
          <Button variant="cta" size="lg" disabled>
            Style a new room
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>No rooms yet</CardTitle>
              <CardDescription>
                Upload a photo of your living room, bedroom, or kitchen and we'll restyle it. Lands
                with M1.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Coming soon · M1
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>No renders yet</CardTitle>
              <CardDescription>
                Restyled rooms with shoppable picking lists will appear here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Coming soon · M1
              </p>
            </CardContent>
          </Card>
        </div>

        <section className="mt-14 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-10">
          <Eyebrow>What's next</Eyebrow>
          <DisplayHeading level={3} className="mt-2 max-w-[680px]">
            The render pipeline arrives in M1 — depth, segmentation, ControlNet, picking list.
          </DisplayHeading>
          <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-ink-soft">
            For now you can poke around the design system, sign in/out, and stare at the warm paper
            background. M1 lands real renders from a single photo.
          </p>
        </section>
      </main>
    </>
  );
}
