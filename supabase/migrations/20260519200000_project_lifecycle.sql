-- myMaison project lifecycle: Analysis → Review → Complete.
--
-- The project moves through three meaningful states:
--   in_progress  : default. Renders being generated, items being matched.
--   in_review    : user has promoted >=1 artefact into the shortlist and is
--                  tweaking + comparing. Multiple images per room allowed.
--   completed    : user has locked the choices. Full breakdown is the
--                  deliverable (every image, every product, prices, total).
--
-- Two new tables back this:
--   staged_images    — persisted virtual-staging composites. /api/stage
--                      currently uploads to storage but doesn't keep a DB
--                      row; without one we can't shortlist them.
--   shortlist_items  — a uniform "thing the user wants to keep" pointer.
--                      Kinds: render | staged | product. Each row links
--                      to a project and to the underlying artefact.

-- Loosen the legacy projects.status check so we can use in_review.
-- Existing values are preserved; in_review is added.
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status in ('in_progress', 'in_review', 'completed', 'archived'));

-- ---------------------------------------------------------------------------
-- staged_images: persisted virtual-staging composites
-- ---------------------------------------------------------------------------
create table if not exists public.staged_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  render_id uuid not null references public.renders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  item_index integer not null,
  image_storage_key text not null,
  prompt text,
  created_at timestamptz not null default now()
);

create index if not exists staged_images_user_id_idx on public.staged_images(user_id);
create index if not exists staged_images_project_id_idx on public.staged_images(project_id);
create index if not exists staged_images_render_id_idx on public.staged_images(render_id);

alter table public.staged_images enable row level security;

drop policy if exists "staged_images_owner_all" on public.staged_images;
create policy "staged_images_owner_all" on public.staged_images
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- shortlist_items: the unified "promote to review" pointer
-- ---------------------------------------------------------------------------
create table if not exists public.shortlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('render', 'staged', 'product')),
  -- Exactly one of these is non-null, matching kind.
  render_id uuid references public.renders(id) on delete cascade,
  staged_image_id uuid references public.staged_images(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  position integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists shortlist_items_project_id_idx on public.shortlist_items(project_id);
create index if not exists shortlist_items_user_id_idx on public.shortlist_items(user_id);

alter table public.shortlist_items enable row level security;

drop policy if exists "shortlist_items_owner_all" on public.shortlist_items;
create policy "shortlist_items_owner_all" on public.shortlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Prevent the same artefact from being shortlisted twice in one project.
create unique index if not exists shortlist_items_render_unique
  on public.shortlist_items(project_id, render_id)
  where render_id is not null;
create unique index if not exists shortlist_items_staged_unique
  on public.shortlist_items(project_id, staged_image_id)
  where staged_image_id is not null;
create unique index if not exists shortlist_items_product_unique
  on public.shortlist_items(project_id, product_id)
  where product_id is not null;
