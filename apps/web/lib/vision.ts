// Room-photo vision analysis. Calls Claude Sonnet 4.6 with the original
// room photo and asks for a structured JSON describing the room's actual
// physical state. This output becomes the ROOM_ANALYSIS injection in the
// designer system prompt.
//
// Cached on rooms.analysis so we only pay for vision once per room.

import Anthropic from '@anthropic-ai/sdk';
import { getServerEnv } from '@/lib/env';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

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

export interface RoomAnalysis {
  room_type: string | null;
  dimensions_approximate_m: {
    width: number | null;
    depth: number | null;
    height: number | null;
  };
  existing_colours: Array<{ surface: string; hex: string | null; description: string }>;
  light: {
    direction: string | null;
    quality: string | null;
    notes: string | null;
  };
  architectural_features: string[];
  existing_furniture: Array<{ item: string; condition: string }>;
  flooring: string | null;
  ceiling_height_m: number | null;
  challenges: string[];
  strengths: string[];
  generated_at: string;
}

const SYSTEM = `You are a room-analysis vision model for myMaison, an Australian interior design platform. You are given a single photo of a real room. Your job is to output a single JSON object describing what is actually in the photo so a designer LLM can make recommendations.

Be precise. Use null for any field you cannot infer confidently from the image — do not guess. Surface dimensions should be given in metres; if you cannot estimate confidently, use null. Hex codes should reflect the dominant colour of each surface as it actually appears. The output JSON must validate against this shape:

{
  "room_type": "living_room" | "lounge_room" | "bedroom" | "kitchen" | "dining_room" | "bathroom" | "study" | "outdoor" | "other" | null,
  "dimensions_approximate_m": { "width": number | null, "depth": number | null, "height": number | null },
  "existing_colours": [{ "surface": "wall" | "floor" | "ceiling" | "trim" | "furniture", "hex": string | null, "description": string }],
  "light": { "direction": "north" | "south" | "east" | "west" | "skylit" | "interior" | null, "quality": string | null, "notes": string | null },
  "architectural_features": string[],
  "existing_furniture": [{ "item": string, "condition": "keep" | "replace" | "uncertain" }],
  "flooring": string | null,
  "ceiling_height_m": number | null,
  "challenges": string[],
  "strengths": string[]
}

CRITICAL — bias toward transformation, not preservation. The user came to myMaison to RESTYLE their room, not to be told what's already fine. When you set the \`condition\` field on existing_furniture, default to "replace" unless:
  - The piece is a permanent fixture (built-in cabinetry, structural fireplace, custom joinery)
  - It is genuinely irreplaceable (a family heirloom is unlikely to register from a photo alone, so this almost never applies)

Soft furnishings, sofas, chairs, lamps, art, rugs, throws, cushions, side tables, coffee tables, decor — these should be "replace" by default. Use "uncertain" only when the photo genuinely doesn't reveal enough for a judgement; never use "uncertain" as a polite middle ground when the piece is replaceable.

Similarly for \`challenges\` and \`strengths\`: a piece you would describe as a "strength" should be a SURFACE the new design can build on (good natural light, generous ceiling height, intact joinery), not an existing piece of furniture that the user has shown they want to change. List too few strengths rather than too many.

DECORATIVE WALL FEATURES — capture these explicitly in \`architectural_features\`. They're load-bearing for the room's character and Flux tends to flatten them into plain paint without an explicit cue. Examples to look for and name precisely:
  - Vertical wall panelling (vee-groove, board-and-batten, shiplap)
  - Wainscoting / dado panelling (lower half of the wall in timber panels)
  - Picture rails, dado rails, chair rails
  - Cornicing / ceiling roses / decorative mouldings
  - Brick or stone feature walls
  - Built-in joinery / shelving / bedheads

When you spot any of these, name them in \`architectural_features\` — e.g. "vertical board-and-batten panelling on the bedhead wall", not just "panelling". The prompt builder uses this verbatim to tell Flux to keep the structure while applying the palette to its finish.

Output ONLY the JSON, no markdown fences, no commentary.`;

export async function analyseRoom(imageUrl: string): Promise<RoomAnalysis> {
  // Claude Sonnet vision accepts either a URL or base64. We pass URL since the
  // signed Supabase URL is already short-lived but publicly fetchable.
  const anthropic = getAnthropic();
  // Haiku is ~3× faster than Sonnet for this structured-extraction task and
  // handles vision more than well enough. Sonnet was occasionally taking
  // >60s on Vercel and getting silently killed by the function timeout.
  //
  // Wrapped in retry-with-backoff because Anthropic returns 529 overloaded
  // intermittently — a single transient failure shouldn't break the user's
  // first impression of the product. 3 attempts at 0/2s/5s recovers the
  // overwhelming majority of overloads silently.
  const message = await withAnthropicRetry(
    () =>
      anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: imageUrl } },
              { type: 'text', text: 'Analyse this room photo and return the JSON described in your system prompt.' },
            ],
          },
        ],
      }),
    { label: 'vision' },
  );

  const text = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  // Strip accidental code fences if Claude adds them despite the instruction.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: Omit<RoomAnalysis, 'generated_at'>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Could not parse room analysis JSON: ${(err as Error).message}\n---raw---\n${text.slice(0, 400)}`,
    );
  }

  return { ...parsed, generated_at: new Date().toISOString() };
}
