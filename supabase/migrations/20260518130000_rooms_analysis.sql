-- M2 designer LLM: cache the room vision-analysis JSON on the rooms row so
-- we don't pay for Claude vision on every advice request. The JSON shape is
-- documented in apps/web/lib/vision.ts.

alter table public.rooms
  add column if not exists analysis jsonb;
