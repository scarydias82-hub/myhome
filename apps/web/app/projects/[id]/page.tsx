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
import { CompleteProjectButton } from '@/components/projects/complete-project-button';
import { ShortlistRow } from '@/components/projects/shortlist-row';
import { ProjectWizard } from '@/components/projects/project-wizard';
import { type BriefPaletteLookup, type BriefStyleLookup } from '@/components/projects/brief-picker';
import { listPalettes, paletteSwatch } from '@/lib/palettes';
import { STYLES } from '@/lib/styles';
import type { BriefSynthesis } from '@/lib/brief/synthesiser';
import type { PickingListItem, PickingMatch } from '@/components/renders/picking-list-panel';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  brief: unknown;
  pinterest_style_profile_id: string | null;
  status: 'in_progress' | 'in_review' | 'completed' | 'archived';
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
  picking_list: PickingListItem[] | null;
  cost_estimate_aud: number | null;
  created_at: string;
}

interface StagedImageRow {
  id: string;
  render_id: string;
  product_id: string | null;
  item_index: number;
  image_storage_key: string;
  created_at: string;
}

interface ShortlistItemRow {
  id: string;
  kind: 'render' | 'staged' | 'product';
  render_id: string | null;
  staged_image_id: string | null;
  product_id: string | null;
  created_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
  dimensions: Record<string, unknown> | null;
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

  const [roomsRes, rendersRes, shortlistRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, photo_url, analysis, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('renders')
      .select('id, status, output_url, picking_list, cost_estimate_aud, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('shortlist_items')
      .select('id, kind, render_id, staged_image_id, product_id, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ]);
  const rooms = (roomsRes.data as RoomRow[] | null) ?? [];
  const renders = (rendersRes.data as RenderRow[] | null) ?? [];
  const shortlist = (shortlistRes.data as ShortlistItemRow[] | null) ?? [];

  // Look up the underlying artefacts that are shortlisted.
  const stagedIds = shortlist.filter((s) => s.staged_image_id).map((s) => s.staged_image_id!);
  const productIds = shortlist.filter((s) => s.product_id).map((s) => s.product_id!);

  const [stagedRes, productsRes] = await Promise.all([
    stagedIds.length
      ? supabase
          .from('staged_images')
          .select('id, render_id, product_id, item_index, image_storage_key, created_at')
          .in('id', stagedIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabase
          .from('products')
          .select(
            'id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, dimensions',
          )
          .in('id', productIds)
      : Promise.resolve({ data: [] }),
  ]);
  const staged = (stagedRes.data as StagedImageRow[] | null) ?? [];
  const products = (productsRes.data as ProductRow[] | null) ?? [];

  // Sign URLs for everything shortlisted.
  const admin = createAdminClient();
  const renderUrlById: Record<string, string> = {};
  for (const r of renders) {
    if (!r.output_url) continue;
    const { data } = await admin.storage.from('renders').createSignedUrl(r.output_url, 60 * 60);
    if (data?.signedUrl) renderUrlById[r.id] = data.signedUrl;
  }
  const stagedUrlById: Record<string, string> = {};
  for (const s of staged) {
    const { data } = await admin.storage
      .from('renders')
      .createSignedUrl(s.image_storage_key, 60 * 60);
    if (data?.signedUrl) stagedUrlById[s.id] = data.signedUrl;
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  // Roll up costs from the shortlist:
  //  - render-kind items contribute their picking_list cost estimate
  //  - product-kind items contribute their unit price
  //  - staged-kind items contribute the price of the staged product (if any)
  let costTotal = 0;
  const shortlistProducts: ProductRow[] = [];
  for (const item of shortlist) {
    if (item.kind === 'render' && item.render_id) {
      const r = renders.find((rr) => rr.id === item.render_id);
      if (r?.cost_estimate_aud) costTotal += r.cost_estimate_aud;
    }
    if (item.kind === 'product' && item.product_id) {
      const p = productById.get(item.product_id);
      if (p) {
        if (p.price_aud) costTotal += p.price_aud;
        shortlistProducts.push(p);
      }
    }
    if (item.kind === 'staged' && item.staged_image_id) {
      const s = staged.find((ss) => ss.id === item.staged_image_id);
      const p = s?.product_id ? productById.get(s.product_id) : null;
      if (p) {
        if (p.price_aud) costTotal += p.price_aud;
        shortlistProducts.push(p);
      }
    }
  }

  // Brief is shaped as { tags: string[], response: BriefSynthesis | null,
  // updated_at: string } in the projects.brief JSONB column. Defensive
  // shape-check tolerates the old briefs that pre-date the tag flow.
  // `inherited_from_user_prefs` (#154 §6.11 Phase B) is set at project
  // create time when the brief was snapshotted from users.preferences;
  // it gets stripped on the first POST /api/projects/[id]/brief which
  // replaces the whole brief shape — so the flag naturally tracks
  // "have they edited this since create?".
  const briefData = (project.brief as
    | {
        tags?: string[];
        response?: BriefSynthesis | null;
        updated_at?: string;
        inherited_from_user_prefs?: boolean;
      }
    | null) ?? null;
  const initialBriefTags = Array.isArray(briefData?.tags) ? briefData!.tags! : [];
  const initialBriefResponse = briefData?.response ?? null;
  const briefInheritedFromUserPrefs = briefData?.inherited_from_user_prefs === true;
  const briefDone = initialBriefResponse !== null;

  // Palette + style lookup tables for the brief response card —
  // server-rendered so we don't have to ship the full palettes.json to
  // the client just to display two names.
  const briefPalettes: BriefPaletteLookup[] = listPalettes().map((p) => ({
    id: p.id,
    name: p.name,
    vibe: p.vibe,
    swatch: paletteSwatch(p),
    timelessness: p.timelessness,
    persona_fit: p.persona_fit,
    tags: p.tags,
  }));
  const briefStyles: BriefStyleLookup[] = STYLES.map((s) => ({
    slug: s.slug,
    name: s.name,
    tagline: s.tagline,
  }));

  // Trend-card images for the three-carousel chooser (#126). Keyed by
  // `${paletteId}__${roomType}` so each carousel card can render the
  // palette applied to the actual room type when a card exists.
  // Falls back to living_room cards if no exact match. Returns a
  // server-rendered public URL — the trends bucket is public.
  const supabasePublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const trendCardsRes = await supabase
    .from('trend_cards')
    .select('palette_id, room_type, image_storage_key');
  const trendCardImages: Record<string, string | null> = {};
  for (const tc of trendCardsRes.data ?? []) {
    const t = tc as { palette_id: string; room_type: string; image_storage_key: string };
    trendCardImages[`${t.palette_id}__${t.room_type}`] =
      `${supabasePublicUrl}/storage/v1/object/public/trends/${t.image_storage_key}`;
  }

  // Room type from the latest room's analysis (server-side read of
  // rooms.analysis.room_type). Used so the carousels prefer cards for
  // the actual room type the user uploaded.
  const latestRoomAnalysis = rooms[0]?.analysis as
    | { room_type?: string | null }
    | null;
  const projectRoomType = latestRoomAnalysis?.room_type ?? null;

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
            <Eyebrow>Project · {new Date(project.created_at).toLocaleDateString('en-AU')}</Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              {project.name}
            </DisplayHeading>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill
                tone={
                  project.status === 'completed'
                    ? 'olive'
                    : project.status === 'in_review'
                      ? 'clay'
                      : 'ink'
                }
                withDot
              >
                {project.status.replace('_', ' ')}
              </Pill>
              {shortlist.length > 0 ? (
                <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  {shortlist.length} in shortlist
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {project.status === 'in_progress' || project.status === 'in_review' ? (
              <Link href={`/rooms/new?projectId=${project.id}`}>
                <Button variant="cta" size="lg">
                  {rooms.length === 0 ? 'Add room photo' : 'New render'}
                </Button>
              </Link>
            ) : null}
            {project.status === 'in_review' && shortlist.length > 0 ? (
              <CompleteProjectButton projectId={project.id} mode="complete" />
            ) : null}
            {project.status === 'completed' ? (
              <CompleteProjectButton projectId={project.id} mode="undo" />
            ) : null}
          </div>
        </div>

        {/* 4-step wizard — replaces the previous ProjectPhases +
            BriefPicker layout (#123). Steps:
              1 · Brief         2 · Photo
              3 · Designer review (synthesis + carousels, #126)
              4 · Renders
            Only rendered for in-progress projects. The review +
            complete states keep the existing gallery layout below. */}
        {project.status === 'in_progress' ? (
          <ProjectWizard
            projectId={project.id}
            initialBriefTags={initialBriefTags}
            initialBriefResponse={initialBriefResponse}
            briefInheritedFromUserPrefs={briefInheritedFromUserPrefs}
            palettes={briefPalettes}
            styles={briefStyles}
            rooms={await Promise.all(
              rooms.map(async (r) => {
                const signed = await supabase.storage
                  .from('rooms')
                  .createSignedUrl(r.photo_url, 60 * 60);
                return {
                  id: r.id,
                  signedPhotoUrl: signed.data?.signedUrl ?? null,
                  hasAnalysis: r.analysis !== null && r.analysis !== undefined,
                  createdAt: r.created_at,
                };
              }),
            )}
            renders={await Promise.all(
              renders.map(async (r) => {
                let outputUrl: string | null = null;
                if (r.output_url) {
                  const signed = await supabase.storage
                    .from('renders')
                    .createSignedUrl(r.output_url, 60 * 60);
                  outputUrl = signed.data?.signedUrl ?? null;
                }
                return {
                  id: r.id,
                  status: r.status,
                  outputUrl,
                  createdAt: r.created_at,
                };
              }),
            )}
            trendCardImages={trendCardImages}
            roomType={projectRoomType}
          />
        ) : null}

        {/* Review phase — gallery of shortlisted artefacts */}
        {project.status === 'in_review' || project.status === 'completed' ? (
          <section>
            <Eyebrow>{project.status === 'completed' ? 'Final selection' : 'In review'}</Eyebrow>
            <DisplayHeading level={3} className="mt-2">
              {shortlist.length} shortlisted {shortlist.length === 1 ? 'item' : 'items'}
            </DisplayHeading>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
              {project.status === 'completed'
                ? "Locked. Here's the final list of images and items."
                : 'Each card is something you promoted past analysis. Keep tweaking — re-render, re-stage, drop items — until the room is right.'}
            </p>

            <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {shortlist.map((item) => (
                <li key={item.id}>
                  <ShortlistRow
                    item={item}
                    projectId={project.id}
                    renderUrl={item.render_id ? renderUrlById[item.render_id] ?? null : null}
                    stagedUrl={
                      item.staged_image_id ? stagedUrlById[item.staged_image_id] ?? null : null
                    }
                    product={item.product_id ? productById.get(item.product_id) ?? null : null}
                    locked={project.status === 'completed'}
                  />
                </li>
              ))}
            </ul>

            {costTotal > 0 ? (
              <section className="mt-12 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8">
                <Eyebrow>Estimated cost</Eyebrow>
                <p className="mt-3 font-display text-h2 text-ink">
                  $
                  {Math.round(costTotal).toLocaleString('en-AU')}
                </p>
                <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
                  Sum of shortlisted product prices and render cost estimates. Labour and install
                  estimates land in a later iteration (painting, hardware, delivery).
                </p>
                {shortlistProducts.length > 0 ? (
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {shortlistProducts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-ink/[0.06] bg-cream px-3 py-2 text-[13px]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-display text-ink">{p.name}</p>
                          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                            {p.retailer}
                          </p>
                        </div>
                        <span className="font-display text-h4 text-ink">
                          {p.price_aud != null
                            ? `$${Math.round(p.price_aud).toLocaleString('en-AU')}`
                            : 'POA'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </section>
        ) : null}

        {/* Always-on: link to all renders */}
        {renders.length > 0 ? (
          <section className="mt-12">
            <Eyebrow>All renders ({renders.length})</Eyebrow>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {renders.map((r) => (
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
