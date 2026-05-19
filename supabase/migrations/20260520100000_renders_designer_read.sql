-- Pre-render designer critique.
--
-- The designer LLM was being called from /renders/[id] on page mount,
-- which meant the user only saw the critique AFTER the render landed.
-- The critique itself doesn't actually depend on the rendered output —
-- it works from the room analysis + selected palette — so it can be
-- generated the moment the user submits a render, then displayed
-- during the render wait. This column persists that critique on the
-- renders row so the page can read it both during wait and after
-- completion without re-running the LLM.

alter table public.renders
  add column if not exists designer_read jsonb;
