// Designer LLM orchestrator. Pulls together:
//   - ROOM_ANALYSIS    (from lib/vision.ts, cached on rooms.analysis)
//   - SELECTED_PALETTE (from lib/palettes.ts)
//   - MATCHED_PRODUCTS (12 candidates from products table, palette-biased)
// …and sends them to Claude Sonnet 4.6 with the designer system prompt.
//
// Output is parsed into the structured shape the UI renders.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import type { Palette } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';
import { fetchKnowledgeContext, formatKnowledgeContext } from '@/lib/knowledge';

// Read once at module load — system prompt rarely changes.
const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'lib', 'prompts', 'designer-system.md');
let SYSTEM_PROMPT_CACHE: string | null = null;

function loadSystemPrompt(): string {
  if (SYSTEM_PROMPT_CACHE) return SYSTEM_PROMPT_CACHE;
  const raw = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  // The file has an `---SYSTEM PROMPT---` marker; everything below is the
  // actual prompt. Everything above is engineering guidance.
  const marker = '---SYSTEM PROMPT---';
  const idx = raw.indexOf(marker);
  SYSTEM_PROMPT_CACHE = idx >= 0 ? raw.slice(idx + marker.length).trim() : raw.trim();
  return SYSTEM_PROMPT_CACHE;
}

export interface DesignerRecommendation {
  product: string;
  retailer: string;
  price: string;
  whyThisRoom: string;
  placement: string;
  scaleCheck: string;
}

export interface DesignerAdvice {
  designerRead: string;
  recommendations: DesignerRecommendation[];
  compositionNote: string;
  watchOutFor: string;
  nextStep: string;
  raw: string;
}

interface CandidateProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  product_url: string;
  image_url: string;
}

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!client) {
    const { ANTHROPIC_API_KEY } = getServerEnv();
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local.');
    }
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

export async function getDesignerAdvice({
  admin,
  roomAnalysis,
  palette,
  limit = 12,
}: {
  admin: SupabaseClient;
  roomAnalysis: RoomAnalysis | null;
  palette: Palette | null;
  limit?: number;
}): Promise<DesignerAdvice> {
  // Run the catalogue lookup and the RAG retrieval in parallel — neither
  // depends on the other and both feed into the same Claude call.
  const [products, knowledge] = await Promise.all([
    fetchCandidates(admin, palette, limit),
    fetchKnowledgeContext({ admin, roomAnalysis, palette }).catch((err) => {
      console.error('knowledge retrieval failed', err);
      return [];
    }),
  ]);

  const userMessage = [
    '## Current room analysis',
    '',
    roomAnalysis
      ? JSON.stringify(roomAnalysis, null, 2)
      : 'Not yet analysed — make style-agnostic suggestions.',
    '',
    '## Selected colour palette',
    '',
    palette
      ? JSON.stringify(palette, null, 2)
      : 'Not yet selected — infer the most suitable palette from the room analysis and name it explicitly before making recommendations.',
    '',
    '## Recent industry insights (RAG context)',
    '',
    formatKnowledgeContext(knowledge),
    '',
    '## Matched product catalogue',
    '',
    JSON.stringify(products, null, 2),
  ].join('\n');

  const anthropic = getAnthropic();
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    temperature: 0.7,
    system: loadSystemPrompt(),
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  return { ...parseDesignerOutput(raw), raw };
}

// Pull a varied set of candidate products. We bias toward the palette's
// recommended categories where we can, but fall back to a mixed selection
// so the LLM has options across the room's surfaces.
async function fetchCandidates(
  admin: SupabaseClient,
  palette: Palette | null,
  limit: number,
): Promise<CandidateProduct[]> {
  // Spread across categories so the LLM can compose a full room.
  const preferredCategories = [
    'Sofas',
    'Chairs',
    'Coffee Tables',
    'Side Tables',
    'Rugs',
    'Lighting',
    'Beds',
    'Dining',
  ];
  const out: CandidateProduct[] = [];
  const perCat = Math.max(1, Math.ceil(limit / preferredCategories.length));
  for (const category of preferredCategories) {
    const { data, error } = await admin
      .from('products')
      .select('id, name, retailer, category, price_aud, product_url, image_url')
      .eq('category', category)
      .not('image_url', 'is', null)
      .limit(perCat);
    if (error) continue;
    out.push(...((data as CandidateProduct[]) ?? []));
    if (out.length >= limit) break;
  }
  if (out.length === 0) {
    // Last-resort: any products at all.
    const { data } = await admin
      .from('products')
      .select('id, name, retailer, category, price_aud, product_url, image_url')
      .limit(limit);
    out.push(...((data as CandidateProduct[]) ?? []));
  }
  // Optional palette-style hint: prepend palette name to product metadata
  // so the LLM can reason about fit. The candidate list itself doesn't get
  // narrowed by palette in v1 — Claude picks what fits.
  if (palette) {
    return out.slice(0, limit).map((p) => ({ ...p, palette_fit_hint: palette.style_tags.join(', ') }) as never);
  }
  return out.slice(0, limit);
}

// Parse the system-prompt OUTPUT FORMAT. The model is instructed to emit
// plain text with labelled sections, not markdown. We split on the labels
// and tolerate small whitespace variations.
function parseDesignerOutput(text: string): Omit<DesignerAdvice, 'raw'> {
  const designerRead = extractSection(text, 'DESIGNER READ', 'RECOMMENDATIONS');
  const recsBlock = extractSection(text, 'RECOMMENDATIONS', 'COMPOSITION NOTE');
  const compositionNote = extractSection(text, 'COMPOSITION NOTE', 'WATCH OUT FOR');
  const watchOutFor = extractSection(text, 'WATCH OUT FOR', 'NEXT STEP');
  const nextStep = extractSection(text, 'NEXT STEP', null);

  return {
    designerRead,
    recommendations: parseRecommendations(recsBlock),
    compositionNote,
    watchOutFor,
    nextStep,
  };
}

function extractSection(text: string, label: string, until: string | null): string {
  const start = findLabel(text, label);
  if (start < 0) return '';
  let end = text.length;
  if (until) {
    const u = findLabel(text, until, start + label.length);
    if (u >= 0) end = u;
  }
  return text.slice(start + label.length, end).trim();
}

function findLabel(text: string, label: string, fromIndex = 0): number {
  // Labels appear on their own line, optionally bolded with ** or surrounded by whitespace.
  const re = new RegExp(`(?:^|\\n)\\s*\\*{0,2}\\s*${label}\\s*\\*{0,2}\\s*(?:\\n|$)`, 'i');
  const sliced = text.slice(fromIndex);
  const m = sliced.match(re);
  if (!m || m.index == null) return -1;
  return fromIndex + m.index + m[0].length - m[0].trimEnd().length + m[0].length;
}

function parseRecommendations(block: string): DesignerRecommendation[] {
  if (!block) return [];
  // Each rec starts with "PRODUCT:" — split on that.
  const chunks = block
    .split(/(?:^|\n)\s*PRODUCT\s*:\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks.map((chunk) => {
    const get = (label: string) => {
      // Match the labelled line up to the next ALL-CAPS label or end.
      const re = new RegExp(
        `${label}\\s*:\\s*([\\s\\S]+?)(?=\\n\\s*(?:RETAILER|PRICE|WHY THIS ROOM|PLACEMENT|SCALE CHECK|PRODUCT)\\s*:|$)`,
        'i',
      );
      const m = chunk.match(re);
      return m && m[1] ? m[1].trim() : '';
    };
    return {
      product: chunk.split(/\n/)[0]?.trim() ?? '',
      retailer: get('RETAILER'),
      price: get('PRICE'),
      whyThisRoom: get('WHY THIS ROOM'),
      placement: get('PLACEMENT'),
      scaleCheck: get('SCALE CHECK'),
    };
  });
}
