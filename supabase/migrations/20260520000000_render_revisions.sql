-- Render revision history.
--
-- Today, every staging call writes to staged_images and uploads the
-- composite to the renders bucket, but renders.output_url still points at
-- the original Flux output. The render page reads output_url and never
-- picks up the staged composite, so from the user's perspective every
-- staging "disappears" the moment they close the modal.
--
-- Fix: capture the original render + every staging as a versioned
-- revision linked to its parent render. renders.active_revision_id
-- points at whichever revision is currently displayed. Users can click
-- any past revision to revert or roll forward without re-calling fal.

create table if not exists public.render_revisions (
  id uuid primary key default gen_random_uuid(),
  render_id uuid not null references public.renders(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- 'original'     — first Flux render, captured at finalisation
  -- 'staged'       — single-product staging via /api/stage
  -- 'multi_staged' — multi-product staging via /api/stage-multi
  kind text not null check (kind in ('original', 'staged', 'multi_staged')),
  -- Storage bucket + path. Both originals and staged composites live in
  -- the 'renders' bucket today, but we store the bucket explicitly so
  -- future migrations (e.g. moving stagings to a dedicated bucket) don't
  -- break the join.
  image_bucket text not null default 'renders',
  image_path text not null,
  -- If this revision came from a staging, link the staged_images row.
  -- staged_images carries the prompt + product list for the cost rollup.
  source_staged_image_id uuid references public.staged_images(id) on delete set null,
  -- Free-text label shown on the revision strip, e.g.
  -- 'Original render', '+ Venus Revolve coffee table', '+ 3 products'.
  label text,
  -- Ascending order on the strip. 0 = original, 1..N = stagings in time order.
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists render_revisions_render_id_sort_idx
  on public.render_revisions(render_id, sort_order);

create index if not exists render_revisions_user_id_idx
  on public.render_revisions(user_id);

-- RLS: users see only their own revisions. Inserts come from the
-- service role inside the API routes — there's no user-facing write path.
alter table public.render_revisions enable row level security;

drop policy if exists "users see own revisions" on public.render_revisions;
create policy "users see own revisions" on public.render_revisions
  for select using (auth.uid() = user_id);

-- Pointer on renders to the currently-active revision. Null means
-- 'use renders.output_url' (legacy / not yet versioned).
alter table public.renders
  add column if not exists active_revision_id uuid
  references public.render_revisions(id) on delete set null;

-- Backfill: create an 'original' revision for every existing render that
-- has an output_url. Idempotent — we skip renders that already have a
-- revision row.
insert into public.render_revisions
  (render_id, user_id, kind, image_bucket, image_path, label, sort_order, created_at)
select
  r.id,
  r.user_id,
  'original',
  'renders',
  r.output_url,
  'Original render',
  0,
  r.created_at
from public.renders r
where r.output_url is not null
  and not exists (
    select 1 from public.render_revisions rev where rev.render_id = r.id
  );

-- Point renders.active_revision_id at the original revision just inserted.
update public.renders r
set active_revision_id = rev.id
from public.render_revisions rev
where rev.render_id = r.id
  and rev.kind = 'original'
  and r.active_revision_id is null;
