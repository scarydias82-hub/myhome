import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/saltbush/pill';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  name: string;
  status: 'in_progress' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
}

export default async function ProjectsPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/projects');

  const res = await supabase
    .from('projects')
    .select('id, name, status, created_at, updated_at')
    .order('updated_at', { ascending: false });
  const projects = (res.data as ProjectRow[] | null) ?? [];

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <Link href="/dashboard" className="hover:text-ink">My renders</Link>
            <span className="text-ink">Projects</span>
          </nav>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="container py-12 md:py-16">
        <div className="mb-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Eyebrow>Projects</Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              Your <em>design engagements</em>.
            </DisplayHeading>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
              A project follows the full residential design lifecycle — Brief, Site analysis,
              Inspiration, Concept, Design, Proposal, Spec. Each one curates the AI's prompt
              before generation.
            </p>
          </div>
          <Link href="/projects/new">
            <Button variant="cta" size="lg">
              + New project
            </Button>
          </Link>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No projects yet</CardTitle>
              <CardDescription>
                Start one to walk through the full curated design flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/projects/new">
                <Button variant="cta">Create your first project</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="group block rounded-xl border border-ink/[0.06] bg-cream p-6 transition hover:shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-h3 text-ink">{p.name}</p>
                      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        Updated {new Date(p.updated_at).toLocaleDateString('en-AU')}
                      </p>
                    </div>
                    <Pill tone={p.status === 'completed' ? 'olive' : p.status === 'archived' ? 'cream' : 'ink'}>
                      {p.status.replace('_', ' ')}
                    </Pill>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
