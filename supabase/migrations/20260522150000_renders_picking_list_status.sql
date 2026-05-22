-- Adds picking_list_status so the render finalise flow can decouple
-- "image done" from "picking list done". The /api/renders/[id]/status
-- route used to block the entire 30-50s matching pipeline inside a
-- single poll response, so users perceived a 60-75s monolithic wait.
-- After this migration the route saves the image + flips status to
-- 'succeeded' in the foreground (~5s) and runs matching via after()
-- in the background. Polling distinguishes "image ready, matches
-- building" from "everything done" via this column.
--
-- States:
--   not_started — render hasn't started matching yet (queued/running)
--   building    — image is saved, matching is in flight
--   ready       — picking_list populated
--   failed      — matching errored; picking_list may be empty/null

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS picking_list_status text;

-- Backfill: any render that already has a picking list is "ready".
-- Anything else (failed renders, abandoned renders, or renders that
-- never built a list because of a pre-migration crash) is "not_started"
-- — the rebuild endpoint can recover them.
UPDATE renders
  SET picking_list_status = CASE
    WHEN picking_list IS NOT NULL THEN 'ready'
    ELSE 'not_started'
  END
  WHERE picking_list_status IS NULL;

ALTER TABLE renders
  ALTER COLUMN picking_list_status SET DEFAULT 'not_started',
  ALTER COLUMN picking_list_status SET NOT NULL;

-- CHECK constraint named explicitly so future code doesn't need to
-- guess the allowed values. Easy to relax if we add more states.
ALTER TABLE renders
  ADD CONSTRAINT renders_picking_list_status_check
  CHECK (picking_list_status IN ('not_started', 'building', 'ready', 'failed'));
