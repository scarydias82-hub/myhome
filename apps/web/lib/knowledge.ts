// Design-knowledge retrieval (RAG) for the designer LLM. We embed a query
// describing the user's room + palette + style, then pull the top-K most
// relevant chunks from public.design_knowledge via the match_design_knowledge
// pgvector RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';
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

// Build a CLIP-friendly query string from the design intent. CLIP's text
// encoder has a 77-token window so we keep this concise.
function buildQuery({
  roomAnalysis,
  palette,
  styleHint,
}: Pick<KnowledgeContextInput, 'roomAnalysis' | 'palette' | 'styleHint'>): string {
  const parts: string[] = [];
  if (palette?.name) parts.push(palette.name);
  if (palette?.style_tags?.length) parts.push(palette.style_tags.slice(0, 3).join(' '));
  if (styleHint) parts.push(styleHint);
  if (roomAnalysis?.room_type) parts.push(roomAnalysis.room_type.replace(/_/g, ' '));
  if (roomAnalysis?.light?.direction) parts.push(`${roomAnalysis.light.direction}-facing light`);
  parts.push('Australian interior design');
  return parts.filter(Boolean).join(', ').slice(0, 240);
}

// Pull relevant tags so we can bias retrieval. Empty array → unfiltered.
function tagFilter({
  palette,
  styleHint,
}: Pick<KnowledgeContextInput, 'palette' | 'styleHint'>): string[] | null {
  const tags = new Set<string>(['au', 'principles', 'evergreen']);
  if (palette?.style_tags) for (const t of palette.style_tags) tags.add(t);
  if (palette?.tags) for (const t of palette.tags) tags.add(t);
  if (styleHint) tags.add(styleHint.toLowerCase());
  return tags.size > 0 ? [...tags] : null;
}

export async function fetchKnowledgeContext({
  admin,
  roomAnalysis,
  palette,
  styleHint,
  limit = 6,
}: KnowledgeContextInput): Promise<KnowledgeChunk[]> {
  const query = buildQuery({ roomAnalysis, palette, styleHint });
  if (!query) return [];

  const queryEmbedding = await embedText(query);
  const filter = tagFilter({ palette, styleHint });

  const { data, error } = await admin.rpc('match_design_knowledge', {
    query_embedding: queryEmbedding,
    match_count: limit,
    tag_filter: filter,
  });
  if (error) {
    console.error('match_design_knowledge rpc failed', error);
    // Retry without tag filter so we at least get something back.
    const fallback = await admin.rpc('match_design_knowledge', {
      query_embedding: queryEmbedding,
      match_count: limit,
      tag_filter: null,
    });
    return ((fallback.data as KnowledgeChunk[] | null) ?? []).filter(Boolean);
  }
  return ((data as KnowledgeChunk[] | null) ?? []).filter(Boolean);
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
