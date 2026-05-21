-- Phase 3 (#136) — link projects back to the vision board they were
-- converted from. Optional FK; when a user creates a project "from
-- scratch" (no source board) this stays null.
--
-- Behaviour: when the source board is deleted, we keep the project
-- (set null on delete) — the project is its own first-class artefact
-- once converted, and losing it just because we cleaned up a
-- moodboard would surprise the user.

alter table public.projects
  add column if not exists source_board_id uuid
    references public.vision_boards(id) on delete set null;

create index if not exists projects_source_board_id_idx
  on public.projects(source_board_id);
