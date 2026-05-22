import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { ShoppableRender } from '@/components/renders/shoppable-render';
import { DesignerRead, type DesignerAdvice } from '@/components/renders/designer-read';
import { RenderPoll } from '@/components/renders/render-poll';
import { RebuildPickingListButton } from '@/components/renders/rebuild-picking-list-button';
import type { PickingListItem } from '@/components/renders/picking-list-panel';
import { ShortlistButton } from '@/components/projects/shortlist-button';
import { RevisionStrip, type RevisionStripItem } from '@/components/renders/revision-strip';
import { RenderActionBand } from '@/components/renders/render-action-band';
import { CompleteTheLook } from '@/components/renders/complete-the-look';
import { fetchCompleteTheLook } from '@/lib/completeTheLook';
import { getStyle } from '@/lib/styles';
import { findPaletteByHexes } from '@/lib/palettes';
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
  project_id: string | null;
  picking_list: PickingListItem[] | null;
  picking_list_status: 'not_started' | 'building' | 'ready' | 'failed' | null;
  cost_estimate_aud: number | null;
  designer_read: DesignerAdvice | null;
}

interface RevisionRow {
  id: string;
  kind: 'original' | 'staged' | 'multi_staged';
  image_bucket: string;
  image_path: string;
  label: string | null;
  sort_order: number;
  created_at: string;
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

  // Primary render query — only legacy columns so the page still loads
  // against a pre-migration schema. The active_revision_id pointer and
  // designer_read are fetched in separate queries below and tolerated
  // as missing (no migration applied yet).
  const renderRes = await supabase
    .from('renders')
    .select('id, status, output_url, created_at, completed_at, room_id, style_profile_id, project_id, picking_list, cost_estimate_aud')
    .eq('id', id)
    .single();
  const render = renderRes.data as RenderRow | null;
  if (!render) notFound();

  // Optional designer_read — present after the
  // 20260520100000_renders_designer_read.sql migration. We fetch it
  // separately so the page loads cleanly against the pre-migration
  // schema; missing column just leaves designer_read null and the
  // DesignerRead component shows its "reading the room" placeholder.
  const designerReadRes = await supabase
    .from('renders')
    .select('designer_read')
    .eq('id', id)
    .maybeSingle();
  if (!designerReadRes.error && designerReadRes.data) {
    render.designer_read =
      (designerReadRes.data as { designer_read: DesignerAdvice | null }).designer_read ?? null;
  }

  // Optional picking_list_status — present after the
  // 20260522150000_renders_picking_list_status.sql migration. Drives
  // the two-stage completion model (image-first, picking list as it
  // builds). Falls back to legacy single-stage behaviour when the
  // column is missing: 'ready' if picking_list is non-null, otherwise
  // 'not_started'.
  const pickingListStatusRes = await supabase
    .from('renders')
    .select('picking_list_status')
    .eq('id', id)
    .maybeSingle();
  if (!pickingListStatusRes.error && pickingListStatusRes.data) {
    render.picking_list_status =
      (pickingListStatusRes.data as {
        picking_list_status: RenderRow['picking_list_status'];
      }).picking_list_status ?? null;
  } else {
    render.picking_list_status = render.picking_list ? 'ready' : 'not_started';
  }

  // Optional active_revision_id — only present after the
  // 20260520 migration. If the column doesn't exist (.error fires) we
  // fall back to the latest revision (or render.output_url) below.
  let activeRevisionId: string | null = null;
  const activePtrRes = await supabase
    .from('renders')
    .select('active_revision_id')
    .eq('id', id)
    .maybeSingle();
  if (!activePtrRes.error && activePtrRes.data) {
    activeRevisionId =
      (activePtrRes.data as { active_revision_id: string | null }).active_revision_id ?? null;
  }

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

  // Seed the saved-state set for heart icons on every match card
  // (P1-7). Best-effort — if the user_wishlist table hasn't been
  // created yet (migration 20260520140000 not applied) the query
  // returns an error and we render every card unsaved.
  let savedProductIds = new Set<string>();
  const wishlistRes = await supabase
    .from('user_wishlist')
    .select('product_id')
    .eq('user_id', user.id);
  if (!wishlistRes.error && wishlistRes.data) {
    savedProductIds = new Set(
      (wishlistRes.data as { product_id: string }[]).map((r) => r.product_id),
    );
  }

  // Fetch every revision so the strip can show full history and we know
  // which image to render as the "after". Once the 20260520 migration has
  // run, every succeeded render has at least an 'original' revision. If
  // the migration hasn't been applied yet the table doesn't exist —
  // .error fires, we treat as empty list, and the page falls back to
  // render.output_url. That's why this page still loads cleanly without
  // the migration.
  const revisionsRes = await supabase
    .from('render_revisions')
    .select('id, kind, image_bucket, image_path, label, sort_order, created_at')
    .eq('render_id', render.id)
    .order('sort_order', { ascending: true });
  const revisions: RevisionRow[] = revisionsRes.error
    ? []
    : ((revisionsRes.data as RevisionRow[] | null) ?? []);

  // Pick the active revision. If active_revision_id is set, use it;
  // otherwise the latest by sort_order; otherwise null (fall back to
  // render.output_url for pre-migration rows).
  const activeRevision =
    (activeRevisionId ? revisions.find((r) => r.id === activeRevisionId) : null) ??
    revisions[revisions.length - 1] ??
    null;

  // Sign URLs server-side so the browser can render private storage objects.
  const admin = createAdminClient();
  const beforeSigned = room?.photo_url
    ? await admin.storage.from('rooms').createSignedUrl(room.photo_url, 60 * 60)
    : null;
  const afterSigned = activeRevision
    ? await admin.storage
        .from(activeRevision.image_bucket)
        .createSignedUrl(activeRevision.image_path, 60 * 60)
    : render.output_url
      ? await admin.storage.from('renders').createSignedUrl(render.output_url, 60 * 60)
      : null;

  // Pre-sign thumbnail URLs for every revision so the strip can render
  // without round-tripping the GET endpoint.
  const signedRevisions: RevisionStripItem[] = await Promise.all(
    revisions.map(async (r) => {
      const sig = await admin.storage.from(r.image_bucket).createSignedUrl(r.image_path, 60 * 60);
      return {
        id: r.id,
        kind: r.kind,
        label: r.label,
        imageUrl: sig.data?.signedUrl ?? null,
        createdAt: r.created_at,
      };
    }),
  );
  const activeRevisionIdForStrip = activeRevision?.id ?? null;

  const isDone = render.status === 'succeeded' && afterSigned?.data?.signedUrl;
  const isFailed = render.status === 'failed' || render.status === 'cancelled';

  // Complete-the-look (#116) — category-aligned picking list under the
  // hotspot one. Resolves the palette id from style_profile.palette hexes
  // (we don't persist palette_id today, just the hex array). Style tags
  // are pulled from the style descriptor's mood + slug. Empty array
  // when render isn't done yet so the section hides itself.
  const ctlPaletteId = findPaletteByHexes(profile?.palette ?? null)?.id ?? null;
  const ctlStyleTags = profile?.source_ref
    ? [...(getStyle(profile.source_ref)?.mood ?? []), profile.source_ref]
    : [];
  const completeTheLookCategories = isDone
    ? await fetchCompleteTheLook({
        admin,
        roomType: room?.room_type ?? null,
        paletteId: ctlPaletteId,
        styleTags: ctlStyleTags,
      })
    : [];

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
            <div className="flex flex-wrap items-center gap-4">
              {render.picking_list_status === 'building' ? (
                <span className="inline-flex items-center gap-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-clay" />
                  </span>
                  Finding matching products…
                </span>
              ) : null}
              <ShortlistButton
                projectId={render.project_id}
                kind="render"
                sourceId={render.id}
                label="Add render to review"
              />
              <RebuildPickingListButton renderId={render.id} />
              <a
                href={afterSigned.data.signedUrl}
                download
                className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
              >
                ↓ Download render
              </a>
            </div>
          ) : null}
        </div>

        {isDone && beforeSigned?.data?.signedUrl && afterSigned?.data?.signedUrl ? (
          <>
            {/* When done: designer read sits BETWEEN the rendered image
                and the picking list. That ordering matters — the
                designer voice frames how to read the room before the
                user starts shopping, mirroring how a real designer
                would walk you through a moodboard. */}
            <ShoppableRender
              beforeUrl={beforeSigned.data.signedUrl}
              afterUrl={afterSigned.data.signedUrl}
              items={render.picking_list ?? []}
              totalEstimateAud={render.cost_estimate_aud}
              renderId={render.id}
              projectId={render.project_id}
              initialSavedProductIds={savedProductIds}
              between={
                <section className="mt-2">
                  <DesignerRead
                    advice={render.designer_read}
                    renderId={render.id}
                    paletteName={profile?.source_ref?.replace(/-/g, ' ') ?? null}
                    roomLabel={room?.room_type?.replace(/_/g, ' ') ?? null}
                  />
                </section>
              }
            />
            <RevisionStrip
              renderId={render.id}
              revisions={signedRevisions}
              activeRevisionId={activeRevisionIdForStrip}
            />
            {/* Complete the look (#116) — category-aligned picks under
                the detection-based hotspot list. Surfaces categories
                the user would shop for this room type (cushions,
                throws, art, lighting, etc.) that the render frame
                didn't necessarily capture. Server-rendered with the
                same palette/style/room filters as the picking list. */}
            {completeTheLookCategories.length > 0 ? (
              <CompleteTheLook
                categories={completeTheLookCategories}
                initialSavedProductIds={savedProductIds}
              />
            ) : null}
            {/* End-of-render action band (#107) — three follow-up moves
                so the user has a clear next step after the wow moment:
                try another palette · share the link · save to project.
                Closes the loop instead of leaving them at the bottom
                of a long scroll with nothing to do. */}
            <RenderActionBand
              renderId={render.id}
              projectId={render.project_id}
            />
          </>
        ) : isFailed ? (
          <>
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
            <section className="mt-10">
              <DesignerRead
                advice={render.designer_read}
                renderId={render.id}
                paletteName={profile?.source_ref?.replace(/-/g, ' ') ?? null}
                roomLabel={room?.room_type?.replace(/_/g, ' ') ?? null}
              />
            </section>
          </>
        ) : (
          <>
            <RenderPoll
              renderId={render.id}
              initialStatus={render.status}
              initialPickingListStatus={render.picking_list_status}
              createdAt={render.created_at}
            />
            {/* During the wait the designer read lives directly below
                the poll spinner — engagement during the 25-60s Flux
                pass, personalised by palette + room. */}
            <section className="mt-10">
              <DesignerRead
                advice={render.designer_read}
                renderId={render.id}
                paletteName={profile?.source_ref?.replace(/-/g, ' ') ?? null}
                roomLabel={room?.room_type?.replace(/_/g, ' ') ?? null}
              />
            </section>
          </>
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
      </main>
    </>
  );
}

