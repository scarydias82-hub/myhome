-- Image references in the design-knowledge RAG.
--
-- The design_knowledge table (20260518140000) shipped as a TEXT-only
-- RAG corpus — each row is a chunk of design guidance retrieved by tag
-- overlap (the embeddings path was abandoned in 2026-05; see the long
-- comment in apps/web/lib/knowledge.ts:1-19).
--
-- The new floorplan-mode (Mode B) render flow wants to ground its
-- aesthetic in actual retailer lifestyle imagery rather than a
-- pre-baked "contemporary Coco materials list" written into the
-- system prompt. Owner directive 2026-05-26: "put images into the rag
-- and have Claude interpret contemporary from those on the fly".
--
-- This migration adds a nullable `image_url` column. Rows with
-- `image_url IS NOT NULL` are "image refs" — text-light, image-heavy
-- rows that get fed to the renderer (or designer narrator) as
-- multimodal input, with chunk_text serving as the alt-text /
-- captioning. Rows with `image_url IS NULL` keep their existing
-- text-only RAG behaviour — every existing chunk continues to work
-- unchanged because the column is nullable.
--
-- A partial index on (image_url) where it's not null gives us an
-- efficient scan when retrieval explicitly asks for image refs only;
-- the existing tag-overlap fetch keeps using the GIN tags index for
-- text-only retrieval.

alter table public.design_knowledge
  add column if not exists image_url text;

create index if not exists design_knowledge_image_url_idx
  on public.design_knowledge (image_url)
  where image_url is not null;
