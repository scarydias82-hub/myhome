-- Projects: the top-level container for a residential design engagement.
-- One project corresponds to "this room, this brief, this aesthetic." Rooms,
-- renders, inspiration boards, and saved style profiles all hang off a
-- project so the user (and the designer LLM) can reason about the whole
-- engagement, not just a single render.
--
-- This follows the standard residential interior design lifecycle:
--   Brief → Site analysis → Inspiration → Concept → Design → Proposal → Spec

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  brief jsonb,
  pinterest_style_profile_id uuid references public.style_profiles(id) on delete set null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists projects_status_idx on public.projects(status);

alter table public.projects enable row level security;

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh.
create or replace function public.touch_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_projects_updated_at();

-- Scope rooms and renders under a project. Both are nullable for backward
-- compatibility — existing rows pre-project still work, they just aren't
-- grouped. The UI can prompt the user to assign them later.
alter table public.rooms
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.renders
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists rooms_project_id_idx on public.rooms(project_id);
create index if not exists renders_project_id_idx on public.renders(project_id);

-- Pinterest OAuth tokens — per user. Stored encrypted by Supabase column
-- encryption when available; until we enable that, only ever read these
-- server-side via service role.
create table if not exists public.pinterest_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  scope text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pinterest_connections enable row level security;

-- Users can read their own connection metadata (without the tokens — the
-- frontend should never select access_token). The RLS policy stays restrictive;
-- selects are funnelled through server routes that mask the token.
drop policy if exists "pinterest_connections_owner" on public.pinterest_connections;
create policy "pinterest_connections_owner" on public.pinterest_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
