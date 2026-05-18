-- Async render pipeline: we now submit the Flux job to fal's queue and poll
-- separately, so we need to remember the queue request id between requests.

alter table public.renders
  add column if not exists fal_request_id text;

create index if not exists renders_fal_request_id_idx
  on public.renders(fal_request_id)
  where fal_request_id is not null;
