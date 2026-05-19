-- Multi-product staging: a single Flux Pro Fill call can place several
-- products into one composite (one mask with multiple white regions, one
-- prompt describing each product). We track every product included so the
-- shortlist + cost rollup understand all of them.

alter table public.staged_images
  add column if not exists product_ids uuid[] not null default '{}';

-- Backfill: copy the existing single product_id into the new array so older
-- staged rows behave consistently.
update public.staged_images
set product_ids = array[product_id]
where product_id is not null and (product_ids is null or array_length(product_ids, 1) is null);

create index if not exists staged_images_product_ids_idx
  on public.staged_images using gin (product_ids);
