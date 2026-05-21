// Vision board image upload → Claude vision identification →
// catalogue match (#139 Pass B).
//
// Flow:
//   1. User uploads an inspiration image (Pinterest pin, IG
//      screenshot, random product photo)
//   2. We resize + store it in the `vision-board-uploads` bucket
//      under <user_id>/<uuid>.jpg
//   3. Claude Sonnet 4.6 (vision-enabled) identifies the primary
//      product: category, style descriptors, colour family, materials
//   4. We query our products table for the best matches based on
//      Claude's identification
//   5. Return matches to the client + create an 'image' board item
//      with the storage key + matched product IDs in payload
//   6. User picks one or more matches to add as separate product
//      board items

import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

export interface ClaudeImageIdentification {
  primary_subject: string;       // "wishbone-style dining chair", "boucle armchair", "brass pendant"
  category: string;              // mapped to our product.category vocabulary
  style_descriptors: string[];   // ["scandi", "warm", "natural-wood"]
  materials: string[];           // ["oak", "boucle"]
  colour_family: string;         // "warm-neutral" | "cool-neutral" | "earth" | "jewel" | etc
  confidence: 'high' | 'medium' | 'low';
}

export interface MatchedProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  // Confidence of THIS match vs the uploaded image, separate from
  // the Claude identification's confidence in WHAT the image shows.
  match_score: number;
}

// Map Claude's free-text category names to our internal vocab. The
// catalogue uses a fixed set (Sofas, Chairs, Coffee Tables, etc.)
// but Claude might say "side chair" or "armchair" — we normalise so
// the SQL filter works.
function normaliseCategory(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (/sofa|couch|lounge|sectional/.test(lower)) return 'Sofas';
  if (/dining chair|side chair|wishbone/.test(lower)) return 'Dining';
  if (/armchair|accent chair|tub chair|wingback/.test(lower)) return 'Chairs';
  if (/coffee table/.test(lower)) return 'Coffee Tables';
  if (/side table|nightstand|bedside/.test(lower)) return 'Side Tables';
  if (/dining table|table/.test(lower)) return 'Dining';
  if (/bed|headboard/.test(lower)) return 'Beds';
  if (/pendant|chandelier|lamp|sconce|lighting/.test(lower)) return 'Lighting';
  if (/rug|runner/.test(lower)) return 'Rugs';
  if (/ottoman|pouf|footstool/.test(lower)) return 'Ottomans';
  if (/sideboard|console|buffet/.test(lower)) return 'Sideboards';
  if (/tap|tapware|faucet|shower/.test(lower)) return 'Bathroom';
  if (/tile/.test(lower)) return 'Tiles';
  if (/quilt|doona|duvet|sheet/.test(lower)) return 'Bedding';
  if (/curtain|sheer|blind/.test(lower)) return 'Window';
  if (/carpet|flooring/.test(lower)) return 'Flooring';
  return null;
}

const IDENTIFY_SYSTEM = `
You are myMaison's catalogue lookup assistant. The user uploads an
inspiration image (could be from Pinterest, Instagram, a magazine
screenshot, a designer's brief — anything). Your job is to identify
the SINGLE primary product in the image so we can match it against
our Australian furniture catalogue.

Be precise about category. Use these category names (we have product
categories that map to these):
- Sofas, Chairs, Coffee Tables, Side Tables, Dining, Beds, Lighting,
  Rugs, Ottomans, Sideboards, Bathroom, Tiles, Bedding, Window,
  Flooring

Style descriptors: 1-3 short tags from this list:
  scandi, japandi, hamptons, coastal, heritage, federation,
  mid-century, modernist, warm-minimalist, contemporary,
  industrial, biophilic, modern-organic, art-deco

Materials: 1-3 tags from oak, walnut, ash, brass, marble, travertine,
linen, boucle, leather, rattan, cane, ceramic, glass, steel, terrazzo

Colour family: one of:
  warm-neutral, cool-neutral, earth, jewel, pastel, monochrome,
  metallic, vibrant

Confidence:
  high   — single clear product, well-lit, easy to identify
  medium — partial view, slight ambiguity, multiple products visible
  low    — too dark, too far, unclear, lifestyle shot with no hero

Output ONLY this JSON shape inside a fenced block:

\`\`\`json
{
  "primary_subject": "<3-6 words — e.g. 'wishbone-style oak dining chair'>",
  "category": "<one of the categories above>",
  "style_descriptors": ["<descriptor>", ...],
  "materials": ["<material>", ...],
  "colour_family": "<one of the colour families>",
  "confidence": "high" | "medium" | "low"
}
\`\`\`

If the image shows no identifiable product (interior shot with no
clear hero, abstract art, person photo, etc), return:
\`\`\`json
{
  "primary_subject": "no-product",
  "category": "Sofas",
  "style_descriptors": [],
  "materials": [],
  "colour_family": "warm-neutral",
  "confidence": "low"
}
\`\`\`
`.trim();

/**
 * Identify the primary product in an image. Image is passed as a
 * base64 string (caller responsible for resize + encoding) along
 * with its media type.
 */
export async function identifyImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<ClaudeImageIdentification> {
  let message: Anthropic.Message;
  try {
    message = await withAnthropicRetry(
      () =>
        getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          temperature: 0.2,
          system: IDENTIFY_SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: imageBase64,
                  },
                },
                {
                  type: 'text',
                  text: 'Identify the primary product in this image. Return JSON only.',
                },
              ],
            },
          ],
        }),
      { label: 'vision-board-image-identify' },
    );
  } catch (err) {
    throw new Error(
      `Image identification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    return JSON.parse(cleaned) as ClaudeImageIdentification;
  } catch (err) {
    throw new Error(
      `Claude returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}\nRaw: ${raw.slice(0, 500)}`,
    );
  }
}

/**
 * Match a Claude identification against our catalogue. Returns up to
 * 6 products ranked by a simple overlap score (category match +
 * style_tag overlap + material overlap).
 */
export async function matchCatalogue(
  admin: SupabaseClient,
  id: ClaudeImageIdentification,
): Promise<MatchedProduct[]> {
  // Cold case — Claude couldn't identify a product.
  if (id.primary_subject === 'no-product' || id.confidence === 'low') {
    return [];
  }

  const normalisedCategory = normaliseCategory(id.category);

  // Fetch candidates — category-filtered if we can normalise, else
  // open. Cap at 60 to keep scoring cheap.
  let query = admin
    .from('products')
    .select(
      'id, name, retailer, category, price_aud, image_url, product_url, affiliate_url, style_tags, materials',
    )
    .not('image_url', 'is', null)
    .limit(60);
  if (normalisedCategory) {
    query = query.eq('category', normalisedCategory);
  }

  const res = await query;
  const candidates =
    (res.data as Array<{
      id: string;
      name: string;
      retailer: string;
      category: string;
      price_aud: number | null;
      image_url: string;
      product_url: string;
      affiliate_url: string | null;
      style_tags: string[] | null;
      materials: string[] | null;
    }> | null) ?? [];

  // Score each candidate.
  const idStyles = new Set(id.style_descriptors.map((s) => s.toLowerCase()));
  const idMaterials = new Set(id.materials.map((m) => m.toLowerCase()));

  const scored = candidates.map((c) => {
    const styleHits = (c.style_tags ?? []).filter((t) => idStyles.has(t.toLowerCase())).length;
    const matHits = (c.materials ?? []).filter((m) => idMaterials.has(m.toLowerCase())).length;
    // Category match (if we normalised) is worth 2 points; each
    // overlapping style tag is 1.5; each material 1. Tunable.
    const score = (normalisedCategory ? 2 : 0) + styleHits * 1.5 + matHits;
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 6).map(({ c, score }) => ({
    id: c.id,
    name: c.name,
    retailer: c.retailer,
    category: c.category,
    price_aud: c.price_aud,
    image_url: c.image_url,
    product_url: c.affiliate_url ?? c.product_url,
    // Normalise to 0..1 for display. Max possible score depends on
    // candidate tag richness — we cap at 8 which is roughly what a
    // perfect match scores.
    match_score: Math.min(1, score / 8),
  }));
}
