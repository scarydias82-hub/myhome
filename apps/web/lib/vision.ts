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
    /** Cardinal compass direction was removed from the vision prompt
     *  on 2026-05-22 (#149) — Claude can't infer compass orientation
     *  from a single photo and guesses produced hallucinated windows
     *  downstream. The field stays as optional on the type so cached
     *  `rooms.analysis` blobs from before the fix still parse; new
     *  analyses will never set it. Treat it as legacy-only on read. */
    direction?: string | null;
    quality: string | null;
    notes: string | null;
  };
  architectural_features: string[];
  existing_furniture: Array<{ item: string; condition: string }>;
  flooring: string | null;
  ceiling_height_m: number | null;
  challenges: string[];
  strengths: string[];
  // 2026-05-22: open-plan layouts. When the photo shows multiple
  // functional zones in one continuous space (e.g. living + dining,
  // living + kitchen, hallway visible past the bed), capture each
  // additional zone here as a short phrase that names it + roughly
  // WHERE it is from the camera's perspective. Empty array when the
  // room is closed-plan. The Kontext prompt builder consumes this to
  // emit "no walls / partitions / windows where the space continues"
  // directives — Kontext's prior otherwise defaults to a bounded box
  // layout because closed-plan rooms dominate its training data.
  // Optional in the type because older cached analyses won't have it.
  open_plan_zones?: string[];
  generated_at: string;
}

const SYSTEM = `You are the first step in myMaison's product recommendation engine. You are given a real room photo of an Australian home. Your job is to identify both what's in the room AND the specific purchase opportunities that will steer the user toward a confident shopping list of pieces to buy. The render that follows is the visual hook; the picking list of products is the deliverable. Frame every observation in that light — what you flag for replacement, what surfaces you read, and what architectural features you preserve are the inputs that make the final shopping list specific and accurate.

Be precise. Use null for any field you cannot infer confidently from the image — do not guess. Surface dimensions should be given in metres; if you cannot estimate confidently, use null. Hex codes should reflect the dominant colour of each surface as it actually appears. The output JSON must validate against this shape:

{
  "room_type": "living_room" | "lounge_room" | "bedroom" | "kitchen" | "dining_room" | "bathroom" | "study" | "outdoor" | "other" | null,
  "dimensions_approximate_m": { "width": number | null, "depth": number | null, "height": number | null },
  "existing_colours": [{ "surface": "wall" | "floor" | "ceiling" | "trim" | "furniture", "hex": string | null, "description": string }],
  "light": { "quality": string | null, "notes": string | null },
  "architectural_features": string[],
  "existing_furniture": [{ "item": string, "condition": "keep" | "replace" | "uncertain" }],
  "flooring": string | null,
  "ceiling_height_m": number | null,
  "challenges": string[],
  "strengths": string[],
  "open_plan_zones": string[]
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

OPEN-PLAN LAYOUTS — capture them explicitly in \`open_plan_zones\`. If the photo shows more than one functional zone continuing into the same space (a dining area visible behind a sofa, a kitchen visible past a living area, a hallway extending into the room past the bed, a stairwell, a void or mezzanine), record each additional zone as a short phrase that names WHAT it is and roughly WHERE it sits from the camera's perspective. Examples:
  - "dining area behind the couch"
  - "kitchen visible to the right, no wall between"
  - "hallway extending past the foot of the bed"
  - "mezzanine void above the living area"

Use an empty array \`[]\` when the room is closed-plan (single zone, walls bound the space on all sides shown). This field is load-bearing for renders of open-plan homes: without it Kontext defaults to a bounded box layout (adds back walls, partitions, extra windows) because closed-plan rooms dominate its training data. List zones generously — over-flagging an open-plan signal is recoverable; under-flagging produces a wall where the user has none.

LIGHT — describe the LIGHT QUALITY only (warm / cool / diffuse / direct / bright / dim / golden hour / overcast), plus any notes about how it falls in the room. Do NOT estimate the cardinal compass direction (north / south / east / west / skylit / interior). You cannot infer compass orientation from a single 2D photo without metadata or a compass — guessing from shadow length and colour temperature has historically been wrong, and the downstream render prompt interprets a wrong cardinal guess by inventing a window on the wall it associates with that direction. Stick to light quality and image-observable notes only.

Output ONLY the JSON, no markdown fences, no commentary.`;

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AnalyseRoomInput {
  buffer: Buffer;
  mediaType: VisionMediaType;
}

export async function analyseRoom(input: AnalyseRoomInput): Promise<RoomAnalysis> {
  // Inline base64 instead of passing a signed URL. With a URL, Anthropic
  // has to perform a server-side fetch back to Supabase (~1-2s of pure
  // latency on top of inference); with base64 we hand the bytes over
  // directly. Same image, same model, same prompt — no quality delta.
  const anthropic = getAnthropic();
  // Haiku is ~3× faster than Sonnet for this structured-extraction task and
  // handles vision more than well enough. Sonnet was occasionally taking
  // >60s on Vercel and getting silently killed by the function timeout.
  //
  // Wrapped in retry-with-backoff because Anthropic returns 529 overloaded
  // intermittently — a single transient failure shouldn't break the user's
  // first impression of the product. Tight schedule [0, 2s, 5s] (3 attempts,
  // 7s of backoff budget) — overloads usually clear within a few seconds
  // and longer waits compound user-perceived latency. Per-call SDK timeout
  // of 25s prevents a single hung call from burning the entire 60s Vercel
  // function budget (SDK default is 600s).
  const message = await withAnthropicRetry(
    () =>
      anthropic.messages.create(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 1500,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.mediaType,
                    data: input.buffer.toString('base64'),
                  },
                },
                { type: 'text', text: 'Analyse this room photo and return the JSON described in your system prompt.' },
              ],
            },
          ],
        },
        { timeout: 25_000 },
      ),
    { label: 'vision', delaysMs: [0, 2000, 5000] },
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
