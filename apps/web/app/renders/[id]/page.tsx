import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { ShoppableRender } from '@/components/renders/shoppable-render';
import { DesignerRead } from '@/components/renders/designer-read';
import type { PickingListItem } from '@/components/renders/picking-list-panel';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface RenderRow {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output_url: string | null;
  created_at: string;
  completed_at: string | null;
  room_id: string;
  style_profile_id: string;
  picking_list: PickingListItem[] | null;
  cost_estimate_aud: number | null;
}
interface RoomRow {
  photo_url: string;
  room_type: string | null;
}
interface ProfileRow {
  style_descriptor: string;
  palette: string[];
  materials: string[];
  mood: string[];
  source_ref: string | null;
}

export default async function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) redirect('/login');
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/renders/${id}`);

  const renderRes = await supabase
    .from('renders')
    .select('id, status, output_url, created_at, completed_at, room_id, style_profile_id, picking_list, cost_estimate_aud')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render) notFound();

  const roomRes = await supabase
    .from('rooms')
    .select('photo_url, room_type')
    .eq('id', render.room_id)
    .single();
  const room = roomRes.data as RoomRow | null;

  const profileRes = await supabase
    .from('style_profiles')
    .select('style_descriptor, palette, materials, mood, source_ref')
    .eq('id', render.style_profile_id)
    .single();
  const profile = profileRes.data as ProfileRow | null;

  // Sign URLs server-side so the browser can render private storage objects.
  const admin = createAdminClient();
  const beforeSigned = room?.photo_url
    ? await admin.storage.from('rooms').createSignedUrl(room.photo_url, 60 * 60)
    : null;
  const afterSigned = render.output_url
    ? await admin.storage.from('renders').createSignedUrl(render.output_url, 60 * 60)
    : null;

  const isDone = render.status === 'succeeded' && afterSigned?.data?.signedUrl;
  const isFailed = render.status === 'failed' || render.status === 'cancelled';

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <div className="flex gap-3">
            <Link
              href="/rooms/new"
              className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
            >
              + New render
            </Link>
            <Link
              href="/dashboard"
              className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="container py-10 md:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>
              Render · {profile?.source_ref ?? 'style'} ·{' '}
              {new Date(render.created_at).toLocaleString('en-AU')}
            </Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              {isDone ? <>The <em>restyle</em>.</> : isFailed ? <>Render <em>failed</em>.</> : <>Rendering…</>}
            </DisplayHeading>
          </div>
          {isDone && afterSigned?.data?.signedUrl ? (
            <a
              href={afterSigned.data.signedUrl}
              download
              className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
            >
              ↓ Download render
            </a>
          ) : null}
        </div>

        {isDone && beforeSigned?.data?.signedUrl && afterSigned?.data?.signedUrl ? (
          <ShoppableRender
            beforeUrl={beforeSigned.data.signedUrl}
            afterUrl={afterSigned.data.signedUrl}
            items={render.picking_list ?? []}
            totalEstimateAud={render.cost_estimate_aud}
          />
        ) : isFailed ? (
          <div className="rounded-xl border border-ink/[0.06] bg-cream p-10 text-center">
            <p className="font-display text-h3 text-ink">Something went sideways.</p>
            <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-soft">
              The render couldn't complete. This is usually transient — try another photo or run it
              again.
            </p>
            <div className="mt-6">
              <Link href="/rooms/new">
                <Button variant="cta" size="lg">
                  Try another render
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <RenderingPlaceholder createdAt={render.created_at} />
        )}

        {profile ? (
          <section className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="md:col-span-1">
              <Eyebrow>Style</Eyebrow>
              <p className="mt-3 font-display text-h4 text-ink capitalize">
                {profile.source_ref?.replace(/-/g, ' ') ?? 'Custom'}
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                {profile.style_descriptor}
              </p>
            </div>
            <div className="md:col-span-1">
              <Eyebrow>Palette</Eyebrow>
              <PaletteStrip colors={profile.palette} className="mt-3 h-8" />
            </div>
            <div className="md:col-span-1">
              <Eyebrow>Materials & mood</Eyebrow>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.materials.map((m) => (
                  <Pill key={`m-${m}`}>{m}</Pill>
                ))}
                {profile.mood.map((m) => (
                  <Pill key={`mo-${m}`} tone="olive">{m}</Pill>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {isDone ? (
          <section className="mt-12">
            <DesignerRead renderId={render.id} />
          </section>
        ) : null}
      </main>
    </>
  );
}

function RenderingPlaceholder({ createdAt }: { createdAt: string }) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  return (
    <div className="grid place-items-center rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-16 text-center">
      <div className="h-3 w-40 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
      </div>
      <p className="mt-6 font-display text-h4 text-ink">Restyling your room…</p>
      <p className="mt-2 max-w-md text-[14px] text-ink-soft">
        Depth map, ControlNet, Flux. Usually under 30 seconds. Started {secs}s ago.
      </p>
    </div>
  );
}
