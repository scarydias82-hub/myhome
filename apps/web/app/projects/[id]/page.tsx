import Link from 'next/link';
import Image from 'next/image';
import { redirect, notFound } from 'next/navigation';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ProjectPhases } from '@/components/projects/project-phases';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  brief: unknown;
  pinterest_style_profile_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RoomRow {
  id: string;
  photo_url: string;
  analysis: unknown;
  created_at: string;
}

interface RenderRow {
  id: string;
  status: string;
  output_url: string | null;
  created_at: string;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) redirect('/login');
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/projects/${id}`);

  const res = await supabase
    .from('projects')
    .select('id, user_id, name, brief, pinterest_style_profile_id, status, created_at, updated_at')
    .eq('id', id)
    .single();
  const project = res.data as ProjectRow | null;
  if (!project) notFound();

  // Pull rooms and renders attached to the project (project_id is nullable
  // so older sessions show nothing here — that's expected).
  const roomsRes = await supabase
    .from('rooms')
    .select('id, photo_url, analysis, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false });
  const rooms = (roomsRes.data as RoomRow[] | null) ?? [];

  const rendersRes = await supabase
    .from('renders')
    .select('id, status, output_url, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false });
  const renders = (rendersRes.data as RenderRow[] | null) ?? [];

  const admin = createAdminClient();
  const latestRender = renders[0];
  const previewUrl = latestRender?.output_url
    ? (await admin.storage.from('renders').createSignedUrl(latestRender.output_url, 60 * 60)).data
        ?.signedUrl ?? null
    : null;

  const briefDone = Boolean(project.brief);
  const siteDone = rooms.length > 0 && rooms.some((r) => r.analysis);
  const inspirationDone = Boolean(project.pinterest_style_profile_id);
  const proposalDone = renders.some((r) => r.status === 'succeeded');

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <Link
            href="/projects"
            className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
          >
            ← Projects
          </Link>
        </div>
      </header>

      <main className="container py-12 md:py-16">
        <div className="mb-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Eyebrow>
              Project · {new Date(project.created_at).toLocaleDateString('en-AU')}
            </Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              {project.name}
            </DisplayHeading>
            <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Status · {project.status.replace('_', ' ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/rooms/new?projectId=${project.id}`}>
              <Button variant="cta" size="lg">
                {rooms.length === 0 ? 'Add room photo' : 'New render'}
              </Button>
            </Link>
          </div>
        </div>

        <ProjectPhases
          projectId={project.id}
          briefDone={briefDone}
          siteDone={siteDone}
          inspirationDone={inspirationDone}
          designDone={false}
          proposalDone={proposalDone}
        />

        {previewUrl && latestRender ? (
          <section className="mt-12">
            <Eyebrow>Latest proposal</Eyebrow>
            <div className="mt-3 overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
              <div className="relative aspect-[4/3] w-full">
                <Image
                  src={previewUrl}
                  alt="Latest render"
                  fill
                  sizes="(max-width: 1024px) 100vw, 70vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  {new Date(latestRender.created_at).toLocaleString('en-AU')}
                </p>
                <Link
                  href={`/renders/${latestRender.id}`}
                  className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
                >
                  Open ↗
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {renders.length > 1 ? (
          <section className="mt-12">
            <Eyebrow>All renders</Eyebrow>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {renders.slice(1).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/renders/${r.id}`}
                    className="block rounded-xl border border-ink/[0.06] bg-cream p-4 transition hover:shadow-soft"
                  >
                    <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      {new Date(r.created_at).toLocaleString('en-AU')}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <Pill tone={r.status === 'succeeded' ? 'olive' : 'cream'}>{r.status}</Pill>
                      <span className="text-clay">→</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
