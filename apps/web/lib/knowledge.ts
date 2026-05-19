// Design-knowledge retrieval for the designer LLM.
//
// HISTORY: this used to embed a query string via CLIP (HF Inference
// API + local @huggingface/transformers fallback) and call the
// match_design_knowledge pgvector RPC. Both paths broke on Vercel:
//   - HF deprecated the sentence-transformers/clip-ViT-B-32 endpoint
//   - The local fallback can't load libonnxruntime.so.1 in Vercel's
//     serverless runtime
//
// With both embedding paths dead, the whole knowledge step would burn
// 25+ seconds trying both before throwing, and /api/render's after()
// block hit the 30s function ceiling. Designer call never ran.
//
// Fix: drop embeddings entirely. The corpus is ~25 chunks — simple
// tag-overlap selection picks 5-6 relevant ones in a single fast
// query. When the corpus grows past ~200 chunks we'll need real
// vector retrieval again; that's the trigger to swap in a working
// embeddings provider (Voyage, OpenAI text-embedding-3, or a
// self-hosted route via Supabase's pg_vector + pgml).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Palette } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';

export interface KnowledgeChunk {
  id: string;
  source: string;
  source_url: string | null;
  title: string | null;
  chunk_text: string;
  tags: string[];
  similarity: number;
}

interface KnowledgeContextInput {
  admin: SupabaseClient;
  roomAnalysis: RoomAnalysis | null;
  palette: Palette | null;
  styleHint?: string | null;
  limit?: number;
}

// Build the tag set we want to overlap against. Every chunk in
// design_knowledge is tagged (au/principles/evergreen plus
// palette-style tags); overlapping these with the user's intent lets
// us pull the right slice without computing a vector similarity.
function buildInterestTags({
  roomAnalysis,
  palette,
  styleHint,
}: Pick<KnowledgeContextInput, 'roomAnalysis' | 'palette' | 'styleHint'>): string[] {
  const tags = new Set<string>(['au', 'principles', 'evergreen']);
  if (palette?.style_tags) for (const t of palette.style_tags) tags.add(t);
  if (palette?.tags) for (const t of palette.tags) tags.add(t);
  if (styleHint) tags.add(styleHint.toLowerCase());
  if (roomAnalysis?.room_type) tags.add(roomAnalysis.room_type.replace(/_/g, ' ').toLowerCase());
  return [...tags];
}

export async function fetchKnowledgeContext({
  admin,
  roomAnalysis,
  palette,
  styleHint,
  limit = 6,
}: KnowledgeContextInput): Promise<KnowledgeChunk[]> {
  const interestTags = buildInterestTags({ roomAnalysis, palette, styleHint });

  // Primary query — chunks whose tag array overlaps any of our
  // interest tags. Postgrest's `overlaps` maps to the `&&` operator on
  // text[] columns.
  const primary = await admin
    .from('design_knowledge')
    .select('id, source, source_url, title, chunk_text, tags')
    .overlaps('tags', interestTags)
    .limit(limit);

  if (!primary.error && primary.data && primary.data.length > 0) {
    return toChunks(primary.data);
  }
  if (primary.error) {
    console.error('design_knowledge overlap fetch failed', primary.error);
  }

  // Fallback — if the tag overlap returned nothing (no chunk matches
  // the user's interests) just grab any N evergreen chunks so the
  // designer LLM has SOME industry context. Better than empty.
  const fallback = await admin
    .from('design_knowledge')
    .select('id, source, source_url, title, chunk_text, tags')
    .limit(limit);
  if (fallback.error) {
    console.error('design_knowledge fallback fetch failed', fallback.error);
    return [];
  }
  return toChunks(fallback.data ?? []);
}

// Stamp a stub similarity so downstream consumers that read this
// field (none today, but the type contract requires it) don't NPE.
function toChunks(rows: unknown[]): KnowledgeChunk[] {
  return (rows as Omit<KnowledgeChunk, 'similarity'>[]).map((row) => ({
    ...row,
    similarity: 1,
  }));
}

export function formatKnowledgeContext(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return 'No additional industry context available.';
  return chunks
    .map((c, i) => {
      const header = c.title ? `${c.source} · ${c.title}` : c.source;
      return `[${i + 1}] ${header}\n${c.chunk_text}`;
    })
    .join('\n\n');
}
