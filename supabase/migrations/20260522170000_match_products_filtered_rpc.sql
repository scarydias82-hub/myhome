-- CLIP-pre-rank RPC for the matcher (#146).
--
-- The existing match_products RPC (20260518120000) returns top-K products
-- by cosine similarity to a query embedding, filtered by a single category.
-- It predates the palette_tags / room_tags signals on products and so can't
-- narrow further than the category.
--
-- This RPC extends it to:
--   - accept a category LIST (matching CATEGORY_FAMILIES in lib/matching.ts
--     which expands "Curtains" → ["Curtains", "Curtains - Sheers", ...])
--   - filter by palette_tags membership when a palette_id is supplied
--   - filter by room_tags overlap (room_type ∪ 'any' sentinel) when a
--     room_type is supplied
--   - sort by HNSW cosine distance, return top match_count
--
-- The matcher pre-rank stage embeds the cropped render region once via
-- @/lib/embeddings (HF Inference on Vercel, LOCAL onnxruntime in dev)
-- and calls this RPC with the embedding + filters. Returns visually-
-- similar candidates that pass the style + room constraints, which then
-- feed the Claude vision ranker. Cheaper than fetching a price-sorted
-- candidate pool because the candidates are pre-narrowed by what the
-- crop actually looks like.
--
-- Returns the same column shape lib/matching.ts ProductRow expects, plus
-- `similarity` (1 - cosine distance, 0..1 where 1 = identical).

CREATE OR REPLACE FUNCTION public.match_products_filtered(
  query_embedding vector(512),
  category_list  text[],
  palette_id     text DEFAULT NULL,
  room_type      text DEFAULT NULL,
  match_count    int  DEFAULT 5
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
    AND p.category = ANY(category_list)
    AND (palette_id IS NULL OR p.palette_tags @> ARRAY[palette_id])
    AND (room_type IS NULL OR p.room_tags && ARRAY[room_type, 'any'])
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Service role only — the API routes call this via createAdminClient.
-- Authenticated users never hit the RPC directly; they go through
-- /api/render which holds the service-role key server-side.
GRANT EXECUTE ON FUNCTION
  public.match_products_filtered(vector, text[], text, text, int)
  TO service_role;
