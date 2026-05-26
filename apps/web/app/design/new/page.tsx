// Mode B entry — "Your room, reimagined" / blank-canvas Coco-only
// design flow. Reuses the same upload + vision step as Mode A
// (/rooms/new) for consistency, but passes flowMode='b' to the
// UploadForm so:
//   - the palette picker filters to MODE_B_PALETTE_IDS (5 curated
//     ultra-contemporary palettes signed off 2026-05-26)
//   - downstream pieces (floorplan confirmation A2, dimension-aware
//     picker A3, blank-canvas render A4) will diverge once they
//     ship
//
// Gated on NEXT_PUBLIC_FLOORPLAN_MODE=true. When the flag is off
// (production default) this route redirects to /rooms/new so any
// link or bookmark to it falls through cleanly to the existing Mode A
// flow rather than 404ing.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { UploadForm } from '@/components/rooms/upload-form';
import { isSupabaseConfigured, isFloorplanModeEnabled } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function NewDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  if (!isSupabaseConfigured) redirect('/login');
  if (!isFloorplanModeEnabled) redirect('/rooms/new');

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/design/new');

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
          <Eyebrow>Design</Eyebrow>
          <DisplayHeading level={2} className="mt-3 max-w-3xl">
            Your room, <em>reimagined</em>.
          </DisplayHeading>
        </div>
        <UploadForm projectId={params.projectId ?? null} flowMode="b" />
      </main>
    </>
  );
}
