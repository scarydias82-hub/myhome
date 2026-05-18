import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { UploadForm } from '@/components/rooms/upload-form';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function NewRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  if (!isSupabaseConfigured) redirect('/login');
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/rooms/new');

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <Link
            href="/dashboard"
            className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="container py-12 md:py-16">
        <div className="mb-10">
          <Eyebrow>New render</Eyebrow>
          <DisplayHeading level={2} className="mt-3 max-w-3xl">
            Show us the <em>room</em>. Pick the <em>vibe</em>.
          </DisplayHeading>
        </div>
        <UploadForm projectId={params.projectId ?? null} />
      </main>
    </>
  );
}
