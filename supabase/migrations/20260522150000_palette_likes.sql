-- palette_likes: per-user palette heart/like. Used to:
--   1. Power the "popular" aggregate sort on the dashboard palette carousel.
--   2. Surface "Your palettes" (palettes the current user has liked) in the
--      carousel and as a filter chip on /palettes.
--
-- No FK to a palettes table because palettes live in palettes.json — palette_id
-- is just the kebab-case slug string. The application validates that the ID
-- exists in the catalogue before inserting.
--
-- RLS: any authenticated user can read all rows (needed for aggregate counts);
-- users can only insert or delete their own rows.

create table public.palette_likes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  palette_id  text        not null,
  created_at  timestamptz not null default now(),
  unique (user_id, palette_id)
);

alter table public.palette_likes enable row level security;

-- Any logged-in user can read all likes so aggregate counts work client-side.
create policy "palette_likes: authenticated read"
  on public.palette_likes for select
  using (auth.uid() is not null);

-- Users can only like on their own behalf.
create policy "palette_likes: insert own"
  on public.palette_likes for insert
  with check (auth.uid() = user_id);

-- Users can unlike only their own rows.
create policy "palette_likes: delete own"
  on public.palette_likes for delete
  using (auth.uid() = user_id);

-- Speed up aggregate count + per-user lookup.
create index palette_likes_palette_id_idx on public.palette_likes (palette_id);
create index palette_likes_user_id_idx    on public.palette_likes (user_id);
