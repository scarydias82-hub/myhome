-- render_mode column on renders. Distinguishes Mode A (the original
-- photo-restyle flow) from Mode B (the new floorplan-confirm +
-- blank-canvas + Coco-only design flow added 2026-05-26).
--
-- Why a typed column rather than re-using an existing field: the
-- two modes diverge in pipeline behaviour (different render prompt,
-- different reference-image set, different result-page copy) and
-- we want downstream surfaces — analytics, result page, the
-- shop-the-look carousels — to branch cleanly on a single signal.
--
--   'restyle' = Mode A: render leans on user's actual room photo,
--               output is "your room reimagined with new finishes
--               + palette". Existing behaviour, all existing rows
--               backfilled to this.
--   'design'  = Mode B: blank-canvas render, output is "a room
--               designed in the contemporary Coco Republic
--               aesthetic for your space's dimensions". Coco
--               lifestyle imagery from design_knowledge (PR #47/49)
--               feeds in as visual style references.
--
-- Default 'restyle' so every existing call site that doesn't yet
-- pass `mode` lands cleanly. Mode B is opt-in via the new
-- `/design/new` entry flow (PR #52) + the request body's `mode`
-- field (A4, this PR).

alter table renders
  add column if not exists render_mode text not null default 'restyle';

alter table renders
  drop constraint if exists renders_render_mode_check;

alter table renders
  add constraint renders_render_mode_check
  check (render_mode in ('restyle', 'design'));

-- Backfill is implicit via the `default 'restyle'` above; every
-- existing row now has render_mode='restyle' set automatically.
