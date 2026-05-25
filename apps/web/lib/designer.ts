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
import { getServerEnv, getRenderRetailerAllowlist } from '@/lib/env';
import type { Palette } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';
import { fetchKnowledgeContext, formatKnowledgeContext } from '@/lib/knowledge';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

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

export interface DesignerAdvice {
  /** One-line, comma-separated list of products in the render with a
   *  single material/colour adjective each (e.g. "Linen cream sofa,
   *  oak coffee table, sculptural travertine lamp"). The render page
   *  shows this as the default at-a-glance read with the longer
   *  sections collapsed behind an expand button. */
  productSummary: string;
  /** Two-to-three sentence greeting describing what's exciting in the
   *  render. Names specific products visible. Positive only — does not
   *  reference the original upload. */
  designerRead: string;
  /** Three-to-four sentence walkthrough of how the palette plays out
   *  across the render. Names the tones (dominant / secondary / accent)
   *  and which products carry each. */
  paletteStory: string;
  /** One-to-two sentence invitation to keep scrolling into the curated
   *  category carousels and use the extended set per category for more
   *  options matched to the palette + style. */
  exploreInvite: string;
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
      : 'Not yet selected — default to warm-minimalist contemporary (warm neutrals + sculptural form + restrained accent) unless the room analysis strongly suggests a different direction. Name the palette family you settled on explicitly before making recommendations.',
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
  // Retry on 529/503/429 — the designer call runs both in /api/render's
  // after() block (best-effort) AND in /api/advise (user-blocking). The
  // user-blocking path benefits from silent recovery, the after() path
  // just gets fewer ghost failures in logs.
  const message = await withAnthropicRetry(
    () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        temperature: 0.7,
        system: loadSystemPrompt(),
        messages: [{ role: 'user', content: userMessage }],
      }),
    { label: 'designer' },
  );

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
  // Test-mode retailer scoping. When set the narrator only sees products
  // from the allowlisted retailers — keeps the post-render commentary
  // honest about what the catalogue actually contains in test mode.
  const retailerAllowlist = getRenderRetailerAllowlist();
  for (const category of preferredCategories) {
    let qb = admin
      .from('products')
      .select('id, name, retailer, category, price_aud, product_url, image_url')
      .eq('category', category)
      .not('image_url', 'is', null);
    if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
    const { data, error } = await qb.limit(perCat);
    if (error) continue;
    out.push(...((data as CandidateProduct[]) ?? []));
    if (out.length >= limit) break;
  }
  if (out.length === 0) {
    // Last-resort: any products at all (subject to test-mode allowlist).
    let qb = admin
      .from('products')
      .select('id, name, retailer, category, price_aud, product_url, image_url');
    if (retailerAllowlist) qb = qb.in('retailer', retailerAllowlist);
    const { data } = await qb.limit(limit);
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
// plain text with three labelled sections — DESIGNER READ, PALETTE STORY,
// EXPLORE INVITE. We split on the labels and tolerate small whitespace
// variations.
function parseDesignerOutput(text: string): Omit<DesignerAdvice, 'raw'> {
  // Section order in the prompt: PRODUCT SUMMARY → DESIGNER READ →
  // PALETTE STORY → EXPLORE INVITE. Each section's `until` parameter
  // is the label of the next section so extraction stops at the
  // right boundary.
  const productSummary = extractSection(text, 'PRODUCT SUMMARY', 'DESIGNER READ');
  const designerRead = extractSection(text, 'DESIGNER READ', 'PALETTE STORY');
  const paletteStory = extractSection(text, 'PALETTE STORY', 'EXPLORE INVITE');
  const exploreInvite = extractSection(text, 'EXPLORE INVITE', null);

  return {
    productSummary,
    designerRead,
    paletteStory,
    exploreInvite,
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

// Note: prior versions of this file parsed a RECOMMENDATIONS section with
// per-product PRODUCT/RETAILER/PRICE/WHY THIS ROOM/PLACEMENT/SCALE CHECK
// blocks. The 2026-05-22 prompt rewrite (excited tone, products-first
// directive) dropped per-product reasoning from the designer's output —
// the category carousels render the products directly, so the designer
// just sets the page tone and frames the curation. The parser was
// removed with the schema change.
