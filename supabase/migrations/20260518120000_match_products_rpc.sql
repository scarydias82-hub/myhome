-- M2: vector-similarity RPC used by the picking-list pipeline. Filters by
-- product category, returns the top-K matches with a 0..1 similarity score
-- (1.0 = identical embedding, 0.0 = orthogonal).

create or replace function public.match_products(
  query_embedding vector(512),
  category_filter text,
  match_count int default 5
)
returns table (
  id uuid,
  name text,
  retailer text,
  category text,
  price_aud numeric,
  image_url text,
  product_url text,
  affiliate_url text,
  similarity float
)
language sql
stable
as $$
  select
    p.id,
    p.name,
    p.retailer,
    p.category,
    p.price_aud,
    p.image_url,
    p.product_url,
    p.affiliate_url,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.products p
  where
    p.embedding is not null
    and (category_filter is null or p.category = category_filter)
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- Allow the service role (used by the API route) to execute. Authenticated
-- users go through the route, not the RPC directly.
grant execute on function public.match_products(vector, text, int) to service_role;
