// /vision-boards/new — name + create. Mirrors /projects/new but
// reframed for the moodboard mental model.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { NewVisionBoardForm } from '@/components/vision-boards/new-vision-board-form';

export default async function NewVisionBoardPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/vision-boards/new');

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <Link
            href="/vision-boards"
            className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
          >
            ← Vision boards
          </Link>
        </div>
      </header>

      <main className="container py-10 md:py-16">
        <div className="mb-8 max-w-2xl md:mb-10">
          <Eyebrow>New vision board</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            Name your <em>board</em>.
          </DisplayHeading>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            Pick a name that captures the room or vibe. Once it's created you can start saving
            palettes, trends, and products you love. No photo or brief required.
          </p>
        </div>
        <NewVisionBoardForm />
      </main>
    </>
  );
}
