-- M0 schema: users, rooms, style_profiles, renders, products + pgvector.
-- RLS is enabled on all user-owned tables; service-role bypasses it for backend writes.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- users (mirrors auth.users; populated by trigger on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now(),
  pinterest_connected_at timestamptz
);

alter table public.users enable row level security;

drop policy if exists "users_select_self" on public.users;
create policy "users_select_self" on public.users
  for select using (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
  for update using (auth.uid() = id);

-- Trigger to mirror auth.users -> public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  photo_url text not null,
  depth_map_url text,
  masks_json jsonb,
  room_type text,
  created_at timestamptz not null default now()
);

create index if not exists rooms_user_id_idx on public.rooms(user_id);

alter table public.rooms enable row level security;

drop policy if exists "rooms_owner_all" on public.rooms;
create policy "rooms_owner_all" on public.rooms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- style_profiles
-- ---------------------------------------------------------------------------
-- 1152 = SigLIP large dim. Adjust later if we switch encoders.
create table if not exists public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('pinterest_board', 'hardcoded', 'custom')),
  source_ref text,
  style_descriptor text not null,
  palette jsonb not null default '[]'::jsonb,
  materials text[] not null default '{}',
  mood text[] not null default '{}',
  embedding vector(1152),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists style_profiles_user_id_idx on public.style_profiles(user_id);

alter table public.style_profiles enable row level security;

drop policy if exists "style_profiles_owner_all" on public.style_profiles;
create policy "style_profiles_owner_all" on public.style_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- renders
-- ---------------------------------------------------------------------------
create table if not exists public.renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  style_profile_id uuid not null references public.style_profiles(id) on delete restrict,
  output_url text,
  picking_list jsonb not null default '[]'::jsonb,
  cost_estimate_aud numeric(10, 2),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists renders_user_id_idx on public.renders(user_id);
create index if not exists renders_status_idx on public.renders(status);

alter table public.renders enable row level security;

drop policy if exists "renders_owner_all" on public.renders;
create policy "renders_owner_all" on public.renders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- products (global catalog, not per-user)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  retailer text not null,
  sku text not null,
  name text not null,
  category text not null,
  price_aud numeric(10, 2) not null,
  image_url text not null,
  product_url text not null,
  affiliate_url text,
  dimensions jsonb,
  materials text[] not null default '{}',
  colors text[] not null default '{}',
  in_stock boolean not null default true,
  ships_to text[] not null default '{AU}',
  embedding vector(1152),
  last_seen_at timestamptz not null default now(),
  unique (retailer, sku)
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_in_stock_idx on public.products(in_stock);
-- HNSW for cosine similarity. Rebuild if dim changes.
create index if not exists products_embedding_idx
  on public.products using hnsw (embedding vector_cosine_ops);

alter table public.products enable row level security;

-- Catalog is readable by any authenticated user; writes restricted to service role.
drop policy if exists "products_read_all" on public.products;
create policy "products_read_all" on public.products
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('rooms', 'rooms', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('renders', 'renders', false)
  on conflict (id) do nothing;

-- Owners can read their own room photos and renders.
drop policy if exists "rooms_storage_owner_read" on storage.objects;
create policy "rooms_storage_owner_read" on storage.objects
  for select using (
    bucket_id = 'rooms' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "renders_storage_owner_read" on storage.objects;
create policy "renders_storage_owner_read" on storage.objects
  for select using (
    bucket_id = 'renders' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "rooms_storage_owner_write" on storage.objects;
create policy "rooms_storage_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'rooms' and auth.uid()::text = (storage.foldername(name))[1]
  );
