import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/saltbush/pill';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface RenderRow {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output_url: string | null;
  created_at: string;
  style_profiles: { source_ref: string | null } | null;
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const firstName = user.email?.split('@')[0] ?? 'there';

  const rendersRes = await supabase
    .from('renders')
    .select('id, status, output_url, created_at, style_profiles(source_ref)')
    .order('created_at', { ascending: false })
    .limit(12);

  const renders = (rendersRes.data ?? []) as unknown as RenderRow[];

  // Sign render thumbnails. Only need short-lived URLs for the dashboard preview.
  const admin = createAdminClient();
  const signed: (string | null)[] = await Promise.all(
    renders.map(async (r) => {
      if (!r.output_url) return null;
      const { data } = await admin.storage.from('renders').createSignedUrl(r.output_url, 60 * 60);
      return data?.signedUrl ?? null;
    }),
  );

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <span className="text-ink">My renders</span>
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
              Your <em>renders</em>.
            </DisplayHeading>
          </div>
          <Link href="/rooms/new">
            <Button variant="cta" size="lg">
              + Style a new room
            </Button>
          </Link>
        </div>

        {renders.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No renders yet</CardTitle>
              <CardDescription>
                Upload a photo of any room and pick a style. First render takes about 30 seconds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/rooms/new">
                <Button variant="cta">Start your first render</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {renders.map((r, i) => (
              <RenderCard key={r.id} render={r} thumbUrl={signed[i] ?? null} />
            ))}
          </div>
        )}

        <section className="mt-14 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-10">
          <Eyebrow>What's next · M2</Eyebrow>
          <DisplayHeading level={3} className="mt-2 max-w-[680px]">
            Picking lists — real AU products under every item in the render.
          </DisplayHeading>
        </section>
      </main>
    </>
  );
}

function RenderCard({ render, thumbUrl }: { render: RenderRow; thumbUrl: string | null }) {
  const statusTone: 'olive' | 'clay' | 'ink' =
    render.status === 'succeeded' ? 'olive' :
    render.status === 'failed' || render.status === 'cancelled' ? 'clay' :
    'ink';
  return (
    <Link
      href={`/renders/${render.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:shadow-soft"
    >
      <div className="relative aspect-[4/3] bg-paper-warm bg-grain">
        {thumbUrl ? (
          <Image
            src={thumbUrl}
            alt="Render preview"
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="grid h-full place-items-center">
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              {render.status === 'running' ? 'Rendering…' : 'No preview'}
            </p>
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="font-display text-h4 text-ink capitalize">
            {render.style_profiles?.source_ref?.replace(/-/g, ' ') ?? 'Custom'}
          </p>
          <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {new Date(render.created_at).toLocaleDateString('en-AU')}
          </p>
        </div>
        <Pill tone={statusTone}>{render.status}</Pill>
      </div>
    </Link>
  );
}
