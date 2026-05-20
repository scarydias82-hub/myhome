// Brief synthesiser — Claude Sonnet maps a project brief (tag list)
// to a palette + style recommendation in designer voice.
//
// The output is the user's first emotional touchpoint with myMaison:
// "you said X — here's what I'd recommend, here's where I'd push back,
// here's what to avoid." A real designer's voice, bounded to the
// existing 10 palettes and 8 styles so we never recommend something
// the catalog can't render.

import Anthropic from '@anthropic-ai/sdk';
import { getServerEnv } from '@/lib/env';
import { listPalettes, type Palette } from '@/lib/palettes';
import { STYLES, type HardcodedStyle, type StyleSlug } from '@/lib/styles';
import { groupTagsByCategory, labelForSlug } from '@/lib/brief/taxonomy';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

export interface BriefRecommendation {
  palette_id: string;
  style_slug: StyleSlug;
  reasoning: string;
}

export interface BriefPushBack {
  concern: string;
  alternative: {
    palette_id: string | null;
    style_slug: StyleSlug | null;
    reasoning: string;
  };
}

export interface BriefAlternative {
  palette_id: string;
  style_slug: StyleSlug;
  one_line_why: string;
}

export interface BriefAvoidance {
  palette_id: string | null;
  style_slug: StyleSlug | null;
  reason: string;
}

export interface BriefSynthesis {
  what_you_said: string;
  recommendation: BriefRecommendation;
  push_back: BriefPushBack | null;
  also_consider: BriefAlternative[];
  avoid: BriefAvoidance[];
  generated_at: string;
}

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
  return client;
}

// Compact palette card — enough for Claude to reason about fit without
// blowing the prompt out. Excludes the full colour hex array (we lean
// on the named role colours + vibe + tags as the semantic surface).
// Persona metadata is critical: timelessness + persona_fit are how
// Claude matches palette to person, not just to trend.
function paletteCard(p: Palette): string {
  return [
    `### ${p.name} (id: ${p.id})`,
    `Vibe: ${p.vibe}`,
    `Timelessness: ${p.timelessness}/10`,
    `Persona fit: ${p.persona_fit.join(', ')}`,
    `Recommended rooms: ${p.recommended_rooms.join(', ')}`,
    `Style affinity: ${p.style_tags.join(', ')}`,
    `Pairs with: ${p.pairs_with_materials.join(', ')}`,
    `Source: ${p.trend_source}`,
    `App note: ${p.app_note}`,
  ].join('\n');
}

function styleCard(s: HardcodedStyle): string {
  return [
    `### ${s.name} (slug: ${s.slug})`,
    `Tagline: ${s.tagline}`,
    `Materials: ${s.materials.join(', ')}`,
    `Mood: ${s.mood.join(', ')}`,
    `Descriptor: ${s.descriptor}`,
  ].join('\n');
}

function buildSystemPrompt(): string {
  const palettes = listPalettes().map(paletteCard).join('\n\n');
  const styles = STYLES.map(styleCard).join('\n\n');
  return `You are a senior Australian interior designer advising a client at the start of a project. The client has just completed a brief — a set of tags describing how they live, the mood they want, materials they like, looks they gravitate to, practical constraints, things they want to avoid, and their time horizon.

Your job is to map their brief to one of our 10 palettes and one of our 8 styles, in designer voice. You're not a sycophant — push back honestly when their tags conflict, and warn them off palettes or styles that would fight their brief.

## PERSONA-AWARE READING (read this FIRST)

Before mapping tags to palettes, infer where the client sits along these four persona axes — because all our palettes are 2026 trend-forward, you need to actively select against trend bias when the client reads as timeless / heritage / safe:

- **Risk tolerance**: safe ↔ adventurous
  - Safe signals: avoid:trendy, avoid:loud-colours, mood:formal, mood:understated, horizon:long-term-investment, constraints:durable, constraints:kid-proof
  - Adventurous signals: mood:dramatic, mood:statement, mood:creative, look:maximalist, look:art-deco

- **Trend appetite**: timeless ↔ of-the-moment
  - Timeless signals: horizon:long-term-investment, horizon:styling-for-resale, avoid:trendy, look:hamptons (classic), constraints:premium-quality
  - Of-the-moment signals: horizon:just-moved-in, mood:playful, look:art-deco, look:maximalist, look:industrial

- **Visual energy**: quiet ↔ vibrant
  - Quiet signals: mood:calm, mood:cocooning, mood:understated, look:japandi, look:minimalist, materials:linen, avoid:loud-colours
  - Vibrant signals: mood:dramatic, mood:energising, mood:statement, mood:creative, look:maximalist, look:boho

- **Era preference**: heritage ↔ contemporary
  - Heritage signals: look:hamptons, look:art-deco, avoid:trendy, materials:brass-bronze, materials:marble, constraints:premium-quality
  - Contemporary signals: look:contemporary-au, look:japandi, look:minimalist, materials:matte-black-metal, materials:travertine

## HOW TO USE THE PALETTE METADATA

Each palette below carries explicit structural signal:
- **Timelessness** (1-10): 1 = trend-of-the-year, 10 = heirloom timeless. For clients reading TIMELESS on the trend-appetite axis, prefer palettes scoring 7+. For OF-THE-MOMENT clients, scores of 3-6 are fine — they want what's hot now.
- **Persona fit**: each palette is tagged with one value per axis. MATCH on every axis when possible. A client reading "safe + timeless + quiet + heritage" should land on a palette whose persona_fit contains all four. Hamptons Heritage (10/10 timelessness, all four matching axes) is the textbook answer.

When NO palette fits all four inferred axes perfectly, choose the palette that matches the MOST axes and acknowledge the gaps in your reasoning. Don't force a square peg.

The palette set now covers BOTH trend-forward 2026 picks (timelessness 3-7) AND timeless persona/era frameworks (timelessness 8-10 — Federation, Hamptons Heritage, Mid-Century Walnut, Coastal Whitewash, English Country, Modernist Restraint). Use the heritage/timeless options for heritage personas — they were added specifically so we don't have to apologise for the 2026-only gap any more.

You MUST surface the persona read in your reasoning field — name the persona axes you inferred and explain how they steered your recommendation.

## AVAILABLE PALETTES

${palettes}

## AVAILABLE STYLES

${styles}

## YOUR OUTPUT

Reply with a single JSON object — no markdown, no commentary outside the JSON. Schema:

{
  "what_you_said": "A 2-3 sentence paraphrase of the client's brief in plain language. Start with 'You're after…' or 'You want…'. Don't list tags — synthesise.",
  "recommendation": {
    "palette_id": "<one of the palette ids above>",
    "style_slug": "<one of the style slugs above>",
    "reasoning": "A 2-3 sentence paragraph in first-person designer voice ('I'd lead with…'). Explain WHY this specific palette+style combination fits the brief. Reference at least two specific tags from their brief by their actual meaning, not the slug."
  },
  "push_back": {
    "concern": "If two or more tags conflict (e.g. 'calm' + 'dramatic', 'family-with-kids' + 'premium-quality marble'), name the conflict in one sentence.",
    "alternative": {
      "palette_id": "<palette id or null>",
      "style_slug": "<style slug or null>",
      "reasoning": "If they relax their position on one tag, what would you recommend instead? 1-2 sentences."
    }
  } OR null if there's no honest push-back to make,
  "also_consider": [
    {
      "palette_id": "<palette id>",
      "style_slug": "<style slug>",
      "one_line_why": "A single sentence — under 20 words. 'If you want X instead, this gives you Y.'"
    }
    // 2-3 alternatives total, ranked by tag-fit after the primary recommendation.
  ],
  "avoid": [
    {
      "palette_id": "<palette id or null>",
      "style_slug": "<style slug or null>",
      "reason": "1-2 sentences. Specific. Reference the tag(s) that make this a bad fit."
    }
    // Include up to 3 explicit avoids if the brief warrants it. Empty array is fine.
  ],
  "generated_at": "<ISO timestamp>"
}

## VOICE RULES

- First person ("I'd recommend…", "I'd push back on…"). Designer-to-client, not assistant-to-user.
- Sentence-case throughout. Never title case.
- Use Australian English (colour, neighbour, behaviour).
- Don't hedge with "might" or "could" everywhere — be opinionated. You're the expert.
- Don't quote tag slugs back to the user — translate them ("you mentioned family with kids", not "you picked lifestyle:family-with-kids").
- Tomato Red & Umber, Transformative Teal, Industrial style — all real choices for the right brief. Don't shy away from bold recommendations when the tags ask for them.
- If they picked the 'lookalike' tag matching one of our styles (e.g. 'look:japandi'), that's a STRONG signal — recommend the matching style unless other tags actively conflict.`;
}

function buildUserMessage(tags: string[]): string {
  const grouped = groupTagsByCategory(tags);
  const sections: string[] = ['The client picked the following tags:', ''];

  for (const [category, slugs] of Object.entries(grouped)) {
    if (slugs.length === 0) continue;
    sections.push(`**${category.toUpperCase()}**`);
    for (const slug of slugs) sections.push(`- ${labelForSlug(slug)}`);
    sections.push('');
  }

  if (tags.length === 0) {
    sections.push('(The client did not pick any tags. Recommend the default palette + style, and ask them in your reasoning to refine the brief.)');
  }

  sections.push('Synthesise a recommendation now. Return only the JSON.');
  return sections.join('\n');
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function synthesiseBrief(tags: string[]): Promise<BriefSynthesis> {
  const anthropic = getAnthropic();
  const message = await withAnthropicRetry(
    () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        temperature: 0.6,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserMessage(tags) }],
      }),
    { label: 'brief-synth' },
  );

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  const cleaned = stripCodeFence(raw);
  let parsed: BriefSynthesis;
  try {
    parsed = JSON.parse(cleaned) as BriefSynthesis;
  } catch (err) {
    throw new Error(
      `Brief synthesiser returned unparseable JSON: ${(err as Error).message}\n---raw---\n${raw.slice(0, 400)}`,
    );
  }

  // Guardrail: ensure the recommendation IDs are real. If Claude
  // hallucinated a palette_id that doesn't exist, fall back to the
  // default palette so we never return junk to the UI.
  const known_palette_ids = new Set(listPalettes().map((p) => p.id));
  const known_style_slugs = new Set(STYLES.map((s) => s.slug));
  if (!known_palette_ids.has(parsed.recommendation.palette_id)) {
    parsed.recommendation.palette_id = 'warm-grounded-earth';
  }
  if (!known_style_slugs.has(parsed.recommendation.style_slug)) {
    parsed.recommendation.style_slug = 'contemporary-au';
  }

  return { ...parsed, generated_at: new Date().toISOString() };
}
