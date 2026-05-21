// Weekly featured-products curation (#137).
//
// Runs as a Vercel cron once per week. Picks ~8 products from the
// AU catalogue, with rotating editorial themes, and writes them to
// featured_products for the dashboard carousel to read.
//
// Cost: one Sonnet 4.6 call with ~100 candidate products in the
// prompt. ~$0.05–0.10 per run.
//
// Selection process:
//   1. Pull a candidate pool of products with image_url + style_tags
//      (~100 quality SKUs across categories + retailers)
//   2. Send to Claude Sonnet with a theme-rotation prompt
//   3. Claude returns { theme, picks: [{ productId, hook, position }] }
//   4. Wipe the previous week's set (or let the until-timestamp
//      expire it) and insert the new rows

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

interface CandidateProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  style_tags: string[] | null;
  materials: string[] | null;
  palette_tags: string[] | null;
}

interface CuratedPick {
  productId: string;
  hook: string;
  position: number;
}

interface ClaudeCurationOutput {
  theme: string;
  reasoning: string;
  picks: CuratedPick[];
}

const CURATION_SYSTEM = `
You are myMaison's editorial director. Once a week you pick 8 products
from our Australian catalogue to feature on the dashboard.

Goals (in priority order):
1. Pick products that are visually compelling, well-photographed, and
   diverse across categories (don't pick 8 sofas).
2. Tell a cohesive editorial story — choose a theme that makes the
   8 picks feel like a curated set, not a random shuffle.
3. Write a punchy hook per product (3-6 words) that gives the user a
   reason to click. Hooks should ground in the theme:
     - Palette-of-the-week:  "Anchors the Warm Earth story",
                             "Picks up the cognac undertone"
     - Retailer-in-focus:    "Featured by GlobeWest",
                             "Coco Republic editor's pick"
     - Persona-of-the-week:  "For the heritage persona",
                             "A vibrant pick"
     - Editor's pick:        "Editor's pick", "Stylist's choice"
4. Bias toward Australian retailers and AU-made / AU-curated picks.
5. Prefer products with strong style_tags or palette_tags — those are
   the products that fit cleanly into a designer's brief.

Rotate themes weekly so the carousel feels fresh:
- palette-of-the-week     (pick a 2026 palette, ground all 8 in it)
- retailer-in-focus       (pick one retailer, show 8 across their range)
- persona-of-the-week     (pick a persona axis — safe/adventurous, etc — and show 8 that match)
- editors-pick            (no theme constraint, just your best 8)

Output:
\`\`\`json
{
  "theme": "palette-of-the-week" | "retailer-in-focus" | "persona-of-the-week" | "editors-pick",
  "reasoning": "1-3 sentences on why this theme + why these picks tell the story",
  "picks": [
    { "productId": "<uuid>", "hook": "<3-6 words>", "position": 0 },
    ...8 picks total, position 0..7
  ]
}
\`\`\`

CRITICAL: Only use productId values from the candidate list. Don't
invent IDs. If the candidate list lacks variety to support a theme,
fall back to "editors-pick" rather than forcing it.
`.trim();

export interface CurationRunResult {
  theme: string;
  picksCount: number;
  reasoning: string;
}

/**
 * Run the weekly curation. Persists results to featured_products
 * with featured_until = now + 7 days. Previous active rows get
 * their featured_until clamped to now() so they fall out of the
 * active set immediately.
 */
export async function runFeaturedCuration(
  admin: SupabaseClient,
): Promise<CurationRunResult> {
  // 1. Pull the candidate pool. Bias to recent + high-quality.
  const candidatesRes = await admin
    .from('products')
    .select('id, name, retailer, category, price_aud, style_tags, materials, palette_tags')
    .not('image_url', 'is', null)
    .not('style_tags', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  const candidates = ((candidatesRes.data as CandidateProduct[] | null) ?? []).filter(
    (c) => c.style_tags && c.style_tags.length > 0,
  );

  if (candidates.length < 16) {
    throw new Error(
      `Not enough candidates (${candidates.length}) — need at least 16 for variety. Scrape more catalogue rows first.`,
    );
  }

  // 2. Send to Claude.
  const userMessage = [
    'Pick 8 products for this week\'s featured set.',
    '',
    '## CANDIDATES',
    '',
    formatCandidatesForPrompt(candidates),
    '',
    'Return JSON only — no commentary outside the fenced block.',
  ].join('\n');

  let message: Anthropic.Message;
  try {
    message = await withAnthropicRetry(
      () =>
        getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          temperature: 0.5,
          system: CURATION_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'featured-curation-weekly' },
    );
  } catch (err) {
    throw new Error(
      `Claude curation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    throw new Error(
      `Claude returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}\nRaw: ${raw.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed.picks) || parsed.picks.length === 0) {
    throw new Error('Claude returned no picks');
  }

  // Validate picks against the candidate IDs to catch hallucinations.
  const validIds = new Set(candidates.map((c) => c.id));
  const validPicks = parsed.picks.filter((p) => validIds.has(p.productId));
  if (validPicks.length === 0) {
    throw new Error('All Claude picks failed ID validation');
  }

  // 3. Expire the previous active set and insert the new rows.
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Clamp prior active rows so they fall out of the carousel.
  await admin
    .from('featured_products')
    .update({ featured_until: nowIso })
    .gt('featured_until', nowIso);

  const insertRows = validPicks.map((p, i) => ({
    product_id: p.productId,
    theme: parsed.theme,
    hook: (p.hook ?? '').slice(0, 80) || 'Featured this week',
    // Trust Claude's position if it gave one; otherwise use index.
    position: typeof p.position === 'number' ? p.position : i,
    featured_from: nowIso,
    featured_until: untilIso,
    reasoning: { theme: parsed.theme, claude_reasoning: parsed.reasoning },
  }));

  const insertRes = await admin.from('featured_products').insert(insertRows);
  if (insertRes.error) {
    throw new Error(`featured_products insert failed: ${insertRes.error.message}`);
  }

  return {
    theme: parsed.theme,
    picksCount: validPicks.length,
    reasoning: parsed.reasoning,
  };
}

function formatCandidatesForPrompt(candidates: CandidateProduct[]): string {
  return candidates
    .map((c, i) => {
      const tags = (c.style_tags ?? []).slice(0, 5).join(', ');
      const palette = (c.palette_tags ?? []).slice(0, 3).join(', ');
      const mats = (c.materials ?? []).slice(0, 3).join(', ');
      const price = c.price_aud != null ? `$${Math.round(c.price_aud)}` : 'POA';
      return [
        `${i + 1}. [${c.id}] ${c.name}`,
        `   ${c.retailer} · ${c.category} · ${price}`,
        `   style: ${tags || '—'}`,
        palette ? `   palette: ${palette}` : null,
        mats ? `   materials: ${mats}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}
