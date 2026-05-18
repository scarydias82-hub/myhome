import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { NewProjectForm } from '@/components/projects/new-project-form';

export default async function NewProjectPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/projects/new');

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
        <div className="mb-10 max-w-2xl">
          <Eyebrow>New project</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            Name your <em>project</em>.
          </DisplayHeading>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            A project is one room (or one space) you're styling. After naming it, we'll walk
            through the curation phases — Brief, Site, Inspiration, Concept, Design — before any
            AI render.
          </p>
        </div>
        <NewProjectForm />
      </main>
    </>
  );
}
