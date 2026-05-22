-- vision_profile-aware CLIP pre-rank for the matcher (#147).
--
-- Parallel to match_products_filtered (#146) but narrows by what Claude
-- Haiku actually saw in the product image during the #145 vision_profile
-- pre-pass, rather than by inherited palette_tags / room_tags. Two
-- sideboards from different retailers tagged warm-grounded-earth that
-- look completely different will now score differently because their
-- palette_fit and room_fit values reflect the individual image, not the
-- palette definition.
--
-- Filter:
--   - category IN category_list
--   - vision_profile.palette_fit[palette_id] >= vision_fit_threshold (0.6 default)
--   - vision_profile.room_fit[room_type] >= vision_fit_threshold
-- Sort:
--   - HNSW cosine distance vs query_embedding (the cropped render region)
-- Limit:
--   - match_count
--
-- A row with no vision_profile (column NULL) is excluded — by design.
-- The matcher's fetchCandidates() falls back to the #146 path (which
-- filters by palette_tags @>) when this RPC returns 0 rows, so until
-- the visionProfile.js backfill is run in production, this function
-- silently returns nothing and the matcher behaves exactly as in #146.
--
-- After backfill: this RPC narrows the candidate pool to products the
-- pre-pass scored as a real palette+room fit, which feeds visually-
-- similar Claude-vetted candidates to the final ranker. Better picks,
-- lower variance.

CREATE OR REPLACE FUNCTION public.match_products_by_vision_profile(
  query_embedding       vector(512),
  category_list         text[],
  palette_id            text DEFAULT NULL,
  room_type             text DEFAULT NULL,
  match_count           int  DEFAULT 5,
  vision_fit_threshold  float DEFAULT 0.6
)
RETURNS TABLE (
  id             uuid,
  name           text,
  retailer       text,
  category       text,
  price_aud      numeric,
  image_url      text,
  product_url    text,
  affiliate_url  text,
  dimensions     jsonb,
  similarity     float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.name,
    p.retailer,
    p.category,
    p.price_aud,
    p.image_url,
    p.product_url,
    p.affiliate_url,
    p.dimensions,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM public.products p
  WHERE
    p.embedding IS NOT NULL
    AND p.image_url IS NOT NULL
    AND p.vision_profile IS NOT NULL
    AND p.category = ANY(category_list)
    AND (
      palette_id IS NULL
      OR COALESCE(
           (p.vision_profile -> 'palette_fit' ->> palette_id)::float,
           0
         ) >= vision_fit_threshold
    )
    AND (
      room_type IS NULL
      OR COALESCE(
           (p.vision_profile -> 'room_fit' ->> room_type)::float,
           0
         ) >= vision_fit_threshold
    )
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION
  public.match_products_by_vision_profile(vector, text[], text, text, int, float)
  TO service_role;
