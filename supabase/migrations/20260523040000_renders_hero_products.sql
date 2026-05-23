-- #174 — persist hero_products on the renders row.
--
-- Until now, the "preselected pieces" (hero products) that the
-- matcher picks before /api/render submits to Flux were only ever
-- in-memory during the submit handler. They were used to bias the
-- text prompt and (post-#173) passed to Kontext as multi-image
-- references, then forgotten. That meant:
--   - The render page couldn't display "what was put into this
--     render" — it could only show the post-render Florence-2
--     picking list (different thing entirely).
--   - The user had to refresh to see the picking list AND would
--     never see the pre-selection at all.
--
-- Adding a jsonb column so /api/render persists them at submit
-- time. The page reads them as "Featured pieces" — visible from the
-- moment the render is queued, no polling race.
--
-- Shape: HeroProductDescriptor[] from lib/styles.ts
--   { name, category, retailer, imageUrl? }

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS hero_products jsonb;

COMMENT ON COLUMN renders.hero_products IS
  'Array of HeroProductDescriptor — the pre-selected catalogue items the matcher chose to bias the Flux prompt + Kontext multi-image refs. Written once by /api/render at submit time; immutable thereafter. Distinct from picking_list which is post-render Florence-2 detection.';
