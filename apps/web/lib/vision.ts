// Room-photo vision analysis. Calls Claude Sonnet 4.6 with the original
// room photo and asks for a structured JSON describing the room's actual
// physical state. This output becomes the ROOM_ANALYSIS injection in the
// designer system prompt.
//
// Cached on rooms.analysis so we only pay for vision once per room.

import Anthropic from '@anthropic-ai/sdk';
import { getServerEnv } from '@/lib/env';

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

const SYSTEM = `You are a room-analysis vision model for myhome, an Australian interior design platform. You are given a single photo of a real room. Your job is to output a single JSON object describing what is actually in the photo so a designer LLM can make recommendations.

Be precise. Use null for any field you cannot infer confidently from the image — do not guess. Surface dimensions should be given in metres; if you cannot estimate confidently, use null. Hex codes should reflect the dominant colour of each surface as it actually appears. The output JSON must validate against this shape:

{
  "room_type": "living_room" | "bedroom" | "kitchen" | "dining_room" | "bathroom" | "study" | "outdoor" | "other" | null,
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

Output ONLY the JSON, no markdown fences, no commentary.`;

export async function analyseRoom(imageUrl: string): Promise<RoomAnalysis> {
  // Claude Sonnet vision accepts either a URL or base64. We pass URL since the
  // signed Supabase URL is already short-lived but publicly fetchable.
  const anthropic = getAnthropic();
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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
  });

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
