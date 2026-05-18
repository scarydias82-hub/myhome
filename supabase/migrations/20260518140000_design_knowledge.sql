-- RAG knowledge base for the designer LLM. Each row is a self-contained
-- chunk of design-relevant content (trend report excerpt, AU climate note,
-- material guidance, etc.) that we retrieve via vector similarity and inject
-- into the designer system prompt as context.

create table if not exists public.design_knowledge (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_url text,
  title text,
  chunk_text text not null,
  chunk_index integer not null default 0,
  tags text[] not null default '{}',
  embedding vector(512),
  published_at timestamptz,
  ingested_at timestamptz not null default now(),
  unique (source, chunk_index)
);

create index if not exists design_knowledge_embedding_idx
  on public.design_knowledge using hnsw (embedding vector_cosine_ops);

create index if not exists design_knowledge_tags_idx
  on public.design_knowledge using gin (tags);

alter table public.design_knowledge enable row level security;

-- Knowledge is global; any authenticated user can read. Writes restricted to
-- service role (ingestion scripts).
drop policy if exists "design_knowledge_read_all" on public.design_knowledge;
create policy "design_knowledge_read_all" on public.design_knowledge
  for select using (auth.role() = 'authenticated');

-- Retrieval RPC. Filters by tag overlap when tag_filter is non-empty;
-- otherwise returns the global top-K by cosine similarity.
create or replace function public.match_design_knowledge(
  query_embedding vector(512),
  match_count int default 6,
  tag_filter text[] default null
)
returns table (
  id uuid,
  source text,
  source_url text,
  title text,
  chunk_text text,
  tags text[],
  similarity float
)
language sql
stable
as $$
  select
    k.id,
    k.source,
    k.source_url,
    k.title,
    k.chunk_text,
    k.tags,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.design_knowledge k
  where
    k.embedding is not null
    and (tag_filter is null or k.tags && tag_filter)
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_design_knowledge(vector, int, text[]) to service_role, authenticated;
