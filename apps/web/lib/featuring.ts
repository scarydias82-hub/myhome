// Auto-pick palette-matched catalogue items to inject as "hero" products
// into the render prompt.
//
// Before this lived, Fal/Flux re-imagined every soft furnishing
// generically — "linen bedding" became Flux's idea of generic linen, not
// an Adairs Mason Quilt Cover. The catalog only entered the picture
// AFTER the render via the picking-list match. That meant the rendered
// duvet never resembled an actual product you could buy.
//
// This module closes part of that gap cheaply: when the user picks a
// palette but doesn't explicitly select featured products, we query
// the palette-tagged catalogue for room-appropriate items, dedupe by
// category for variety, and pass the top N as `heroProducts` so
// buildPrompt names them in the Flux prompt ("featuring Adairs Mason
// quilt cover in pecan, Coco Republic Eldron bed, Freedom Vinta rug").
// Flux still paints a generic interpretation but anchors closer to a
// real product. ~40% closure of the catalog-to-render gap; the other
// 60% needs IP-Adapter or post-render composite (tasks deferred).

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HeroProductDescriptor } from '@/lib/styles';
import { getServerEnv } from '@/lib/env';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { labelForSlug } from '@/lib/brief/taxonomy';
import type { RoomAnalysis } from '@/lib/vision';
import type { BriefSynthesis } from '@/lib/brief/synthesiser';

// Category labels used by individual scrapers — they don't agree on
// plural vs singular (Poliform writes "Sofa", Koala writes "Sofas") so
// the hints lists include both forms. The query uses `.in()` which is
// an exact-match, so we list every variant explicitly.
const ROOM_CATEGORY_HINTS: Record<string, string[]> = {
  bedroom: [
    'Quilt Covers',
    'Bed', 'Beds',
    'Bedside Table', 'Bedside Tables',
    'Wardrobe',
    'Rugs', 'Carpet', 'Flooring',
    'Curtains - Sheers', 'Curtains - Blockout',
  ],
  living_room: [
    'Sofa', 'Sofas',
    'Armchair', 'Chair', 'Chairs',
    'Coffee Table', 'Coffee Tables',
    'Occasional Tables',
    'Sideboards',
    'Mirrors',
    'Rugs', 'Carpet', 'Flooring',
    'Curtains - Sheers',
    'Lighting',
  ],
  lounge_room: [
    'Sofa', 'Sofas',
    'Armchair',
    'Coffee Table', 'Coffee Tables',
    'Rugs', 'Carpet', 'Flooring',
    'Lighting',
  ],
  dining_room: [
    'Dining',
    'Table', 'Tables',
    'Chair', 'Chairs',
    'Rugs', 'Flooring',
    'Lighting',
  ],
  kitchen: ['Stools', 'Flooring', 'Tiles', 'Lighting'],
  bathroom: ['Tiles', 'Curtains - Sheers', 'Flooring'],
  study: ['Desk', 'Chair', 'Chairs', 'Storage System', 'Rugs', 'Flooring', 'Lighting'],
};

const DEFAULT_HINTS = ['Sofa', 'Sofas', 'Rugs', 'Lighting'];

export function categoriesForRoom(roomType: string | null | undefined): string[] {
  if (!roomType) return DEFAULT_HINTS;
  // Normalise "Living Room" / "living-room" / "living_room" / "LIVING" all to
  // "living_room". Then match any key the room type contains.
  const norm = roomType.toLowerCase().replace(/[\s-]+/g, '_');
  for (const [key, cats] of Object.entries(ROOM_CATEGORY_HINTS)) {
    if (norm.includes(key) || key.includes(norm)) return cats;
  }
  // "living" matches "living_room"; "bed" matches "bedroom" via the
  // key.includes(norm) check above. Anything else → defaults.
  return DEFAULT_HINTS;
}

// Query the products table for palette-matched, room-appropriate items.
// Returns up to `limit` HeroProductDescriptors, deduplicated by category
// so we don't get e.g. three quilt covers when one quilt + one bed +
// one rug is what we want. Skips Dulux (paint goes into the prompt via
// the palette directive, not as a featured object).
export async function autoFeatureForPalette({
  admin,
  paletteId,
  roomType,
  limit = 3,
}: {
  admin: SupabaseClient;
  paletteId: string;
  roomType: string | null | undefined;
  limit?: number;
}): Promise<HeroProductDescriptor[]> {
  const cats = categoriesForRoom(roomType);
  if (cats.length === 0) return [];
  // Pull a pool (5x limit) so we have room to dedupe by category and
  // still hit `limit`. Order by id for deterministic results — same
  // palette+room renders should auto-feature the same products
  // session-to-session, which makes eval iteration reproducible.
  const { data, error } = await admin
    .from('products')
    .select('name, category, retailer')
    .contains('palette_tags', [paletteId])
    .in('category', cats)
    .neq('retailer', 'Dulux')
    .order('id', { ascending: true })
    .limit(limit * 6);
  if (error) {
    console.warn('[featuring] auto-pick query failed', error.message);
    return [];
  }
  if (!data?.length) return [];

  // One per category for variety.
  const seenCats = new Set<string>();
  const picked: HeroProductDescriptor[] = [];
  for (const p of data as Array<{ name: string; category: string; retailer: string }>) {
    if (seenCats.has(p.category)) continue;
    seenCats.add(p.category);
    picked.push({ name: p.name, category: p.category, retailer: p.retailer });
    if (picked.length >= limit) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Claude-curated featured products (#129) — default path
// ---------------------------------------------------------------------------
//
// Replaces autoFeatureForPalette as the primary featured-products
// source on /api/render. The metadata-only function above stays as
// the fallback when Claude is unavailable or returns nothing usable.
//
// Why default-on:
//   - Respects the brief's avoid list (no chrome when avoid:cool-metals)
//   - Matches material preferences (linen / oak / matte-black-metal)
//   - Considers room scale (small room → tighter profile picks)
//   - Cross-product cohesion (sofa material → table material → lamp)
//   - Costs ~$0.017/render, adds ~10s latency which overlaps with fal
//
// Failure mode: returns [] on parse failure / Claude exhausted retries.
// The /api/render flow then falls back to autoFeatureForPalette so the
// render still goes through with metadata-only picks. Anthropic
// outages degrade gracefully — they never block a render.

interface CandidateProduct {
  id: string;
  name: string;
  category: string;
  retailer: string;
  price_aud: number | null;
  materials: string[] | null;
}

interface ClaudeCurationOutput {
  picks: Array<{ product_id: string; category: string; reasoning: string }>;
}

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
  return _anthropic;
}

const CURATION_SYSTEM = `You are a senior Australian interior designer curating products that will anchor a virtual room render.

The user has chosen a palette and style. You'll see the room's actual properties (light, flooring, dimensions, architecture), their brief (lifestyle preferences and what they want to avoid), and a candidate set of palette-matched products organised by category. Pick 3-5 products that together would best anchor the render.

## SELECTION RULES (in priority order)

1. RESPECT THE AVOID LIST. If a candidate has materials or finishes that violate the user's avoid signals, exclude it. Examples:
   - User picked avoid:cool-metals → no chrome, no polished nickel, no brushed steel
   - User picked avoid:glossy-finishes → no high-gloss laminate, no polished marble
   - User picked avoid:fussy-patterns → no busy florals or geometric prints
   - User picked avoid:trendy → prefer timeless silhouettes over of-the-moment shapes
2. MATERIAL ALIGNMENT. Match the user's materials preferences when they have any:
   - materials:warm-oak → prefer products that mention oak or warm timber
   - materials:linen → prefer fabric-rich pieces
   - materials:travertine → prefer stone, not marble or glass
3. ROOM SCALE. Read the room dimensions:
   - Small room (< 12 sqm) → tighter-profile pieces, not bulky sectionals
   - Standard (12-25 sqm) → balanced silhouettes
   - Large (> 25 sqm) → can carry statement pieces
4. CROSS-PRODUCT COHESION. Picks should feel like they belong in the same room. Don't mix bouclé sofa + glass coffee table + leather floor lamp; pick a coherent material story.
5. CATEGORY VARIETY. One pick per major category — not three sofas. Aim for one of: sofa OR bed (the anchor), one occasional surface (coffee table / side table), one lighting piece, optionally one rug or art.

## OUTPUT FORMAT

Reply with a single JSON object. No markdown fences, no commentary outside JSON.

{
  "picks": [
    { "product_id": "<uuid from the candidate set>", "category": "<category as listed>", "reasoning": "<1 sentence why>" }
  ]
}

Pick between 3 and 5 items. Use ONLY product_ids from the candidate set — never invent.`;

function formatCandidatesForPrompt(candidatesByCategory: Record<string, CandidateProduct[]>): string {
  const sections: string[] = [];
  for (const [category, candidates] of Object.entries(candidatesByCategory)) {
    if (candidates.length === 0) continue;
    sections.push(`### ${category}`);
    for (const c of candidates) {
      const materials = c.materials?.filter(Boolean).join(', ') ?? '';
      const price = c.price_aud != null ? `$${Math.round(c.price_aud)}` : 'POA';
      sections.push(
        `- id=${c.id} · "${c.name}" · ${c.retailer} · ${price}${materials ? ` · materials: ${materials}` : ''}`,
      );
    }
    sections.push('');
  }
  return sections.join('\n');
}

function formatRoomFactsForPrompt(facts: RoomAnalysis | null): string {
  if (!facts) return '_(no room analysis available — pick on brief alone)_';
  const parts: string[] = [];
  if (facts.room_type) parts.push(`- Room type: ${facts.room_type.replace(/_/g, ' ')}`);
  const d = facts.dimensions_approximate_m;
  if (d?.width && d?.depth) {
    const sqm = (d.width * d.depth).toFixed(1);
    parts.push(`- Dimensions: ${d.width}m × ${d.depth}m (~${sqm} sqm)`);
  }
  if (facts.light?.direction) {
    parts.push(`- Light: ${facts.light.direction}-facing${facts.light.quality ? ` (${facts.light.quality})` : ''}`);
  }
  if (facts.flooring) parts.push(`- Existing flooring: ${facts.flooring}`);
  if (facts.architectural_features?.length) {
    parts.push(`- Architectural features: ${facts.architectural_features.join(', ')}`);
  }
  return parts.length ? parts.join('\n') : '_(no notable facts)_';
}

function formatBriefForPrompt(brief: BriefSynthesis | null, tags: string[]): string {
  const sections: string[] = [];
  if (tags.length > 0) {
    sections.push('### Brief tags');
    for (const slug of tags) sections.push(`- ${labelForSlug(slug)}`);
    sections.push('');
  }
  if (brief) {
    sections.push('### Designer recommendation');
    sections.push(`Palette: ${brief.recommendation.palette_id}`);
    sections.push(`Style: ${brief.recommendation.style_slug}`);
    sections.push(`Reasoning: ${brief.recommendation.reasoning}`);
    sections.push('');
    if (brief.avoid.length > 0) {
      sections.push('### EXPLICIT AVOID LIST');
      for (const a of brief.avoid) {
        const target = a.palette_id ?? a.style_slug ?? 'unknown';
        sections.push(`- ${target}: ${a.reason}`);
      }
      sections.push('');
    }
  }
  return sections.join('\n') || '_(no brief synthesised — pick on palette + style only)_';
}

async function fetchCandidatesByCategory(
  admin: SupabaseClient,
  paletteId: string,
  roomType: string | null,
  perCategory = 8,
): Promise<Record<string, CandidateProduct[]>> {
  const categories = categoriesForRoom(roomType);
  if (categories.length === 0) return {};
  const normalisedRoom = (roomType ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const roomFilter = normalisedRoom ? [normalisedRoom, 'any'] : ['any'];

  // Single query then bucket in memory — cheaper than N round-trips
  // per category. Pool size = perCategory × number of categories so
  // each bucket can fill independently.
  const { data, error } = await admin
    .from('products')
    .select('id, name, category, retailer, price_aud, materials')
    .in('category', categories)
    .contains('palette_tags', [paletteId])
    .overlaps('room_tags', roomFilter)
    .neq('retailer', 'Dulux')
    .not('image_url', 'is', null)
    .order('price_aud', { ascending: false, nullsFirst: false })
    .limit(perCategory * categories.length);

  if (error || !data) {
    console.warn('[featuring] Claude-path candidate fetch failed', error?.message);
    return {};
  }

  const buckets: Record<string, CandidateProduct[]> = {};
  for (const row of data as CandidateProduct[]) {
    const bucket = (buckets[row.category] ??= []);
    if (bucket.length < perCategory) bucket.push(row);
  }
  return buckets;
}

export async function autoFeatureClaude({
  admin,
  paletteId,
  paletteName,
  styleSlug,
  styleName,
  roomType,
  roomFacts,
  briefResponse,
  briefTags,
  limit = 4,
}: {
  admin: SupabaseClient;
  paletteId: string;
  paletteName: string;
  styleSlug: string;
  styleName: string;
  roomType: string | null;
  roomFacts: RoomAnalysis | null;
  briefResponse: BriefSynthesis | null;
  briefTags: string[];
  limit?: number;
}): Promise<HeroProductDescriptor[]> {
  const candidates = await fetchCandidatesByCategory(admin, paletteId, roomType);
  const totalCandidates = Object.values(candidates).reduce((s, arr) => s + arr.length, 0);
  if (totalCandidates < 3) {
    // Not enough candidates to curate meaningfully. Let the fallback
    // path try — it has wider relaxation tiers.
    return [];
  }

  const userMessage = [
    '## ROOM',
    formatRoomFactsForPrompt(roomFacts),
    '',
    '## BRIEF',
    formatBriefForPrompt(briefResponse, briefTags),
    '',
    '## SELECTED DIRECTION',
    `Palette: ${paletteName} (id: ${paletteId})`,
    `Style: ${styleName} (slug: ${styleSlug})`,
    '',
    '## CANDIDATE PRODUCTS (palette + room matched)',
    '',
    formatCandidatesForPrompt(candidates),
    '',
    `Pick ${limit} products now. Return JSON only.`,
  ].join('\n');

  let message: Anthropic.Message;
  try {
    message = await withAnthropicRetry(
      () =>
        getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          temperature: 0.4,
          system: CURATION_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'auto-feature-claude' },
    );
  } catch (err) {
    console.warn(
      '[featuring] Claude curation failed after retries — returning empty so caller falls back to metadata path',
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: ClaudeCurationOutput;
  try {
    parsed = JSON.parse(cleaned) as ClaudeCurationOutput;
  } catch (err) {
    console.warn(
      '[featuring] Claude curation returned unparseable JSON, falling back',
      (err as Error).message,
      raw.slice(0, 200),
    );
    return [];
  }

  if (!Array.isArray(parsed.picks) || parsed.picks.length === 0) {
    console.warn('[featuring] Claude curation returned no picks, falling back');
    return [];
  }

  // Resolve each pick back to a candidate row. Drop hallucinated IDs
  // silently — the rest of the picks still count.
  const flatCandidates = new Map<string, CandidateProduct>();
  for (const list of Object.values(candidates)) {
    for (const c of list) flatCandidates.set(c.id, c);
  }
  const heroProducts: HeroProductDescriptor[] = [];
  for (const pick of parsed.picks.slice(0, limit)) {
    const cand = flatCandidates.get(pick.product_id);
    if (!cand) {
      console.warn(`[featuring] Claude picked unknown id ${pick.product_id} — skipping`);
      continue;
    }
    heroProducts.push({
      name: cand.name,
      category: cand.category,
      retailer: cand.retailer,
    });
  }

  if (heroProducts.length === 0) {
    console.warn('[featuring] all Claude picks were hallucinated ids — falling back');
    return [];
  }

  console.log(
    `[featuring] Claude-curated ${heroProducts.length} for palette=${paletteId} room=${roomType}: ` +
      heroProducts.map((p) => `${p.retailer}/${p.category}/${p.name}`).join(' · '),
  );
  return heroProducts;
}
