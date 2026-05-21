-- Phase 4 (#137) — weekly Claude-curated featured product set.
--
-- One row per featured product per curation window. The dashboard's
-- Featured carousel reads rows where now() < featured_until, ordered
-- by position. Historical rows are kept so we can A/B-test themes
-- or audit what got featured when.
--
-- Theme rotates weekly: 'palette-of-the-week', 'retailer-in-focus',
-- 'persona-of-the-week', 'editors-pick'. The Claude prompt picks the
-- theme based on what we haven't done recently.

create table if not exists public.featured_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- Free-text theme slug — exposed to the curation prompt so Claude
  -- can rotate without us hardcoding the list. Kept loose so we can
  -- experiment with new themes without a migration.
  theme text not null,
  -- Editorial provenance copy surfaced as the carousel chip:
  -- "Editor's pick", "Featured by GlobeWest", "For the heritage
  -- persona", etc. Claude writes this per-product.
  hook text not null,
  -- 0-based position within the week's set. Drives the carousel
  -- order so we can express "the floor lamp is the centerpiece"
  -- by putting it at position 0.
  position integer not null default 0,
  featured_from timestamptz not null default now(),
  featured_until timestamptz not null,
  -- Optional reasoning blob from Claude — kept for audit but not
  -- surfaced to users. Useful when debugging "why did Claude pick
  -- this?" later.
  reasoning jsonb,
  created_at timestamptz not null default now()
);

-- Active set lookup: where now() between featured_from and
-- featured_until. The until_idx is the primary filter; covering
-- position lets us order without a separate sort step.
create index if not exists featured_products_active_idx
  on public.featured_products(featured_until, position);

-- Read-only for end users (the dashboard server pages use either
-- supabase or admin clients; either way the policy permits select).
alter table public.featured_products enable row level security;

drop policy if exists "featured_products_read_all" on public.featured_products;
create policy "featured_products_read_all" on public.featured_products
  for select to authenticated using (true);
