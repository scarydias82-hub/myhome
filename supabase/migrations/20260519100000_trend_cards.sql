-- AI-generated trend hero cards. One row per (palette, room_type) combination.
-- Pre-generated offline by apps/scraper/scripts/generate-trends.js so the
-- dashboard render is fast and free.

create table if not exists public.trend_cards (
  id uuid primary key default gen_random_uuid(),
  palette_id text not null,
  palette_name text not null,
  room_type text not null,
  headline text not null,
  description text not null,
  image_storage_key text not null,
  source_signal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (palette_id, room_type)
);

create index if not exists trend_cards_room_type_idx on public.trend_cards(room_type);
create index if not exists trend_cards_palette_id_idx on public.trend_cards(palette_id);

alter table public.trend_cards enable row level security;

-- Trend cards are global content; any authenticated user can read.
drop policy if exists "trend_cards_read_all" on public.trend_cards;
create policy "trend_cards_read_all" on public.trend_cards
  for select using (auth.role() = 'authenticated');

-- Public bucket for trend hero images (cached, served via Vercel/Next Image).
insert into storage.buckets (id, name, public)
  values ('trends', 'trends', true)
  on conflict (id) do nothing;

drop policy if exists "trends_public_read" on storage.objects;
create policy "trends_public_read" on storage.objects
  for select using (bucket_id = 'trends');
