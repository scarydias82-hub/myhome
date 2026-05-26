-- Per-product preferred image index for the render reference set.
--
-- For most products, image_urls[0] (the primary studio shot) is the
-- right reference for gpt-image-1 — it's an isolated product on a
-- plain background, easy for the model to reason about and place in
-- the scene.
--
-- Rugs are the exception. Retailers (Coco Republic included) routinely
-- publish a styled-room lifestyle photo at image_urls[0] — the rug
-- shown in a furnished room with cushions, lamps, etc. That's a good
-- marketing image but a TERRIBLE render reference: gpt-image-1 has
-- to mentally un-pick the rug from the styled scene before composing
-- it into the user's room, and it routinely fails (the user reported
-- the "rug with foliage" failure on 2026-05-26).
--
-- The aerial / flat-lay shot is the right reference for rugs. It's
-- often present in image_urls[1..N] but never reliably at the same
-- index across products. R2 (2026-05-26) populates this column via
-- a Claude-vision classification pass: for each Coco rug product
-- with a multi-image array, classify each image as aerial / lifestyle
-- / detail and set preferred_render_image_index to the best aerial
-- (falls back to NULL when no aerial is found).
--
-- R3 (2026-05-26) — render route's pickRenderReferenceUrls reads
-- this column and uses image_urls[preferred_render_image_index] as
-- the first product-reference image when set, falling back to
-- image_urls[0] otherwise.
--
-- Currently populated for Coco rug rows only; can be extended later
-- to other floor-covering retailers or to differentiated angles for
-- furniture categories (e.g. seated-perspective for sofas).

alter table products
  add column if not exists preferred_render_image_index integer;

-- Sanity check: index must be non-negative (NULL is fine, means
-- "no preference — use image_urls[0] as before").
alter table products
  drop constraint if exists products_preferred_render_image_index_nonneg;

alter table products
  add constraint products_preferred_render_image_index_nonneg
  check (preferred_render_image_index is null or preferred_render_image_index >= 0);
