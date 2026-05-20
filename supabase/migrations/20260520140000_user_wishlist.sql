-- Per-user product wishlist — saves a product independent of any
-- particular render or project. Lets the picking-list match card show
-- a heart-icon "Save" CTA next to "Stage in my room" so the user can
-- bank options across multiple renders without having to commit to a
-- project first.
--
-- Distinct from shortlists (project_lifecycle migrations) which are
-- project-scoped commitments at the "I'm going to buy this for this
-- room" stage. Wishlist is the "save for later" stage that happens
-- BEFORE a user decides which project the item belongs to.

create table if not exists public.user_wishlist (
  user_id    uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists user_wishlist_user_id_idx
  on public.user_wishlist(user_id);

create index if not exists user_wishlist_saved_at_idx
  on public.user_wishlist(saved_at desc);

alter table public.user_wishlist enable row level security;

drop policy if exists "user_wishlist_owner_all" on public.user_wishlist;
create policy "user_wishlist_owner_all" on public.user_wishlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
