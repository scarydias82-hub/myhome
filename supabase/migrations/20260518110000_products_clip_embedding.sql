-- M2: switch products.embedding from SigLIP (1152-dim, planned) to CLIP
-- ViT-Base-Patch32 (512-dim) which we run locally via transformers.js.
-- We also drop and recreate the HNSW cosine index because index dimensions
-- are baked in at creation time.

drop index if exists products_embedding_idx;

alter table public.products
  drop column if exists embedding;

alter table public.products
  add column embedding vector(512);

create index if not exists products_embedding_idx
  on public.products using hnsw (embedding vector_cosine_ops);
