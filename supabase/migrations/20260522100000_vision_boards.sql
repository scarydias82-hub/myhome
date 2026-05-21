-- Vision boards (#135) — user-owned moodboards that collect palettes,
-- trend cards, products, and free-text notes. Designed as a lower-
-- commitment alternative to projects: a user can save things they
-- like into a board without uploading a room photo, then convert the
-- board into a project when they're ready (Phase 3, #136).
--
-- Schema design:
--   vision_boards         — header row per board, owned by user
--   vision_board_items    — polymorphic membership rows
--
-- The items table is polymorphic across four item types:
--   palette  → palette_id text (slug from palettes.json)
--   trend    → trend_card_id uuid (FK to trend_cards.id)
--   product  → product_id uuid (FK to products.id)
--   note     → free-text in payload JSON, no FK
--
-- Exactly one ref column is non-null per row, matching item_type.
-- Uniqueness indexes prevent the same artefact from being added
-- twice within one board.

create table if not exists public.vision_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- Optional explicit cover image. When null the UI falls back to the
  -- first product/trend item's image as the cover thumbnail.
  cover_image_url text,
  -- Denormalised item count — refreshed by triggers below so that the
  -- listing query doesn't need a sub-select per row.
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vision_boards_user_id_idx on public.vision_boards(user_id);
create index if not exists vision_boards_updated_at_idx on public.vision_boards(updated_at desc);

alter table public.vision_boards enable row level security;

drop policy if exists "vision_boards_owner_all" on public.vision_boards;
create policy "vision_boards_owner_all" on public.vision_boards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Polymorphic item rows.
create table if not exists public.vision_board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.vision_boards(id) on delete cascade,
  item_type text not null check (item_type in ('palette', 'trend', 'product', 'note')),
  -- Polymorphic refs (mutually exclusive — see check constraint below).
  palette_id text,
  trend_card_id uuid references public.trend_cards(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  -- payload carries:
  --   notes: free-text body, optional caption
  --   palette/trend/product: optional "why I saved this" caption
  payload jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  -- Polymorphic integrity: the correct ref column is populated for
  -- the chosen item_type, others are null. Notes have no FK ref.
  constraint vbi_polymorphic_ref check (
    (item_type = 'palette' and palette_id is not null and trend_card_id is null and product_id is null)
    or (item_type = 'trend' and trend_card_id is not null and palette_id is null and product_id is null)
    or (item_type = 'product' and product_id is not null and palette_id is null and trend_card_id is null)
    or (item_type = 'note' and palette_id is null and trend_card_id is null and product_id is null)
  )
);

create index if not exists vision_board_items_board_id_idx
  on public.vision_board_items(board_id);

-- Prevent the same artefact from being saved twice within a board.
-- Each unique index is partial so it only applies when that ref
-- column is populated.
create unique index if not exists vision_board_items_palette_unique
  on public.vision_board_items(board_id, palette_id)
  where palette_id is not null;

create unique index if not exists vision_board_items_trend_unique
  on public.vision_board_items(board_id, trend_card_id)
  where trend_card_id is not null;

create unique index if not exists vision_board_items_product_unique
  on public.vision_board_items(board_id, product_id)
  where product_id is not null;

alter table public.vision_board_items enable row level security;

-- Item-level RLS: a user can manage items in boards they own. We
-- check ownership via the parent vision_boards row rather than
-- duplicating user_id on every item — cheaper writes, single source
-- of truth.
drop policy if exists "vision_board_items_via_board" on public.vision_board_items;
create policy "vision_board_items_via_board" on public.vision_board_items
  for all using (
    exists (
      select 1 from public.vision_boards b
      where b.id = board_id and b.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.vision_boards b
      where b.id = board_id and b.user_id = auth.uid()
    )
  );

-- Trigger to keep vision_boards.item_count + updated_at in sync
-- with vision_board_items membership. Saves a sub-select on every
-- list query.
create or replace function public.refresh_vision_board_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.vision_boards
      set item_count = item_count + 1,
          updated_at = now()
      where id = new.board_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.vision_boards
      set item_count = greatest(0, item_count - 1),
          updated_at = now()
      where id = old.board_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists vision_board_items_count_trigger on public.vision_board_items;
create trigger vision_board_items_count_trigger
  after insert or delete on public.vision_board_items
  for each row execute function public.refresh_vision_board_count();
