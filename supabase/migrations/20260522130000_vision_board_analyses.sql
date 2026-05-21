-- Vision board analyses (#139) — cached Claude-vision designer
-- critiques for vision boards.
--
-- Each row is one analysis run. We keep history so users can see how
-- their board has evolved over time (and so we can debug Claude's
-- output later). The board detail page reads the latest row.
--
-- Response shape (jsonb):
--   {
--     "coherence": { "through_line", "tensions", "strength",
--                    "summary_for_user" },
--     "room_styles": ["scandi", "warm_minimalist", ...],
--     "popularity": { "comparable_boards", "headline", "differentiator" },
--     "retailer_recommendations": [
--       { "retailer", "reason", "categories": [...] }
--     ]
--   }
--
-- Snapshot captures the item_count + counts per item_type at run time,
-- so we can tell the UI when the board has drifted enough to warrant
-- a re-run.

create table if not exists public.vision_board_analyses (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.vision_boards(id) on delete cascade,
  response jsonb not null,
  -- { item_count: int, by_type: { palette: int, trend: int, product: int, note: int, image: int } }
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vision_board_analyses_board_id_idx
  on public.vision_board_analyses(board_id);
create index if not exists vision_board_analyses_recent_idx
  on public.vision_board_analyses(board_id, created_at desc);

alter table public.vision_board_analyses enable row level security;

drop policy if exists "vision_board_analyses_via_board" on public.vision_board_analyses;
create policy "vision_board_analyses_via_board" on public.vision_board_analyses
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
