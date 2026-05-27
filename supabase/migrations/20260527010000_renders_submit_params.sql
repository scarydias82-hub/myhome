-- Add submit_params JSONB column to renders for the failed-render
-- "Try again" flow.
--
-- When a render fails (any reason — Mode C tunnel down, ComfyUI
-- execution error, output fetch timeout), the user currently has
-- no in-app recovery: they have to navigate back to the upload
-- form and re-pick everything. Storing the original POST body on
-- the renders row lets the failed-render page surface a single-
-- click "Try again" that re-submits the same render request,
-- creating a fresh row with the same parameters.
--
-- Schema choice: JSONB blob rather than typed columns. The render
-- POST body has 5-6 fields (roomId, paletteId, style, mode,
-- featuredProductIds, projectId, promptOverride) and may grow as
-- new flow options ship. Storing the whole body as one blob means
-- new fields auto-flow through without per-field migrations.
--
-- Backwards compat: existing rows get NULL. The TryAgainButton
-- treats NULL as "retry unavailable" — only renders created post-
-- this-migration get the button.

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS submit_params jsonb;

COMMENT ON COLUMN renders.submit_params IS
  'Original /api/render POST body. Surfaced to the failed-render page so the user can re-submit with one click. Null for renders predating PR #78 (2026-05-27).';
