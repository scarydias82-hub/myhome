-- #165 — observability for the #82 auto-stage hook in
-- /api/renders/[id]/status. Until now the hook logged to Vercel only;
-- when an auto-stage failed (composite, harmonise, upload, revision
-- insert) the failure was visible only in the function logs and the
-- absence of a `multi_staged` render_revisions row. Adding two columns
-- so the failure surface is visible from the DB:
--
--   auto_stage_status — null when the hook never ran, otherwise one of:
--     'skipped' (kill-switch, no room photo, no stageable items)
--     'started' (set just before stageMultipleProducts)
--     'completed' (revision appended and active_revision_id updated)
--     'failed' (stageMultipleProducts, harmonise, upload, or insert threw)
--   auto_stage_error — populated on 'failed' or 'skipped' so the
--     reason is human-readable in one column.
--
-- Pure additive — existing renders read back null and the page treats
-- null as "no auto-stage attempted yet" (same UX as today).

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS auto_stage_status text,
  ADD COLUMN IF NOT EXISTS auto_stage_error text;

-- Soft enum check — easier to expand later than a hard CHECK constraint.
COMMENT ON COLUMN renders.auto_stage_status IS
  'Outcome of the #82 auto-stage hook in /api/renders/[id]/status. Values: null | started | completed | failed | skipped. See lib/auto-stage.ts for the writer.';
COMMENT ON COLUMN renders.auto_stage_error IS
  'Human-readable reason when auto_stage_status is failed or skipped. Populated by lib/auto-stage.ts on the failure path.';

-- Index for the "show me renders that failed auto-stage" admin query.
-- Partial so we don't bloat with mostly-null values.
CREATE INDEX IF NOT EXISTS renders_auto_stage_status_idx
  ON renders (auto_stage_status)
  WHERE auto_stage_status IS NOT NULL;
