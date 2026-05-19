// Claude Sonnet vision evaluator. Given the original room photo, the
// rendered output, the designer's stated direction, and the picking
// list we generated, score the render on six criteria and surface
// qualitative notes Claude Code can act on.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

export interface ScoreBlock {
  score: number; // 1-10
  notes: string;
}

export interface Scorecard {
  directionMatch: ScoreBlock;
  geometryPreserved: ScoreBlock;
  surfaceTransformation: ScoreBlock;
  hallucinationFreedom: ScoreBlock; // higher = fewer invented features
  pickingListDensity: ScoreBlock;
  paletteAdherence: ScoreBlock;
  verdict: string; // overall plain-English summary
  topFailureModes: string[]; // 0-3 specific failure patterns this render shows
  configSuggestions: string[]; // 0-3 concrete tuning suggestions
  raw: string;
}

const SYSTEM = `You are a senior interior designer evaluating an AI-generated room render against the original room photo and the designer's stated direction.

You return a JSON scorecard with these fields, each scored 1-10:

  - directionMatch         How closely the render follows the designer's stated direction (palette, materials, mood).
  - geometryPreserved      Are walls, window openings, door openings, ceiling height, and camera angle the same as the original?
  - surfaceTransformation  Were walls / floors / curtains actually repainted / restyled with the chosen palette? 1 = nothing changed, 10 = surfaces fully transformed.
  - hallucinationFreedom   Did Flux invent features that weren't there? Extra windows, ceiling vents, fences outside an upstairs window, changed view, etc. 10 = none; 1 = many.
  - pickingListDensity     Did the picking list capture the major visible items? Out of what's actually IN the render, did we offer most of them as shoppable?
  - paletteAdherence       Does the render's colour story match the chosen palette? 10 = palette is dominant and coherent; 1 = the palette is invisible.

Plus three extra fields:

  - verdict              Two sentences. Plain English. Does this render meet the bar a homeowner would commit to staging products into?
  - topFailureModes      0-3 specific failure patterns. e.g. "ceiling vent hallucinated", "wall colour unchanged despite warm palette", "view through window changed from upstairs to ground floor".
  - configSuggestions    0-3 concrete suggestions Claude Code can implement. e.g. "tighten canny strength to 0.7 to reduce ceiling hallucinations", "explicitly call out the panelled wall in the prompt", "drop strength to 0.85 — current 0.87 is overshooting".

Output ONLY the JSON. No markdown fences. No commentary. If you cannot judge something, mark its score as 5 (neutral) and explain in notes.`;

interface EvaluateInput {
  originalImageUrl: string;
  renderedImageUrl: string;
  designerRead: string;
  styleSlug: string;
  paletteName: string;
  pickingListLabels: string[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY missing');
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

export async function evaluateRender(input: EvaluateInput): Promise<Scorecard> {
  const c = getClient();
  const userText = [
    `STYLE: ${input.styleSlug}`,
    `PALETTE: ${input.paletteName}`,
    '',
    `DESIGNER STATED:\n${input.designerRead.slice(0, 1200)}`,
    '',
    `PICKING LIST DETECTED (${input.pickingListLabels.length} items): ${input.pickingListLabels.join(', ') || '(none)'}`,
    '',
    'IMAGE 1 = original room photo. IMAGE 2 = rendered output. Score the render against the criteria.',
  ].join('\n');

  const message = await c.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image', source: { type: 'url', url: input.originalImageUrl } },
          { type: 'image', source: { type: 'url', url: input.renderedImageUrl } },
        ],
      },
    ],
  });

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  type Json = Record<string, unknown>;
  let parsed: Json;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Could not parse evaluator JSON: ${(err as Error).message}\n---raw---\n${raw.slice(0, 600)}`,
    );
  }

  const toBlock = (k: string): ScoreBlock => {
    const v = parsed[k];
    if (v && typeof v === 'object') {
      const obj = v as { score?: unknown; notes?: unknown };
      const score = typeof obj.score === 'number' ? obj.score : 5;
      const notes = typeof obj.notes === 'string' ? obj.notes : '';
      return { score, notes };
    }
    return { score: 5, notes: '' };
  };

  return {
    directionMatch: toBlock('directionMatch'),
    geometryPreserved: toBlock('geometryPreserved'),
    surfaceTransformation: toBlock('surfaceTransformation'),
    hallucinationFreedom: toBlock('hallucinationFreedom'),
    pickingListDensity: toBlock('pickingListDensity'),
    paletteAdherence: toBlock('paletteAdherence'),
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict : '',
    topFailureModes: Array.isArray(parsed.topFailureModes)
      ? (parsed.topFailureModes as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    configSuggestions: Array.isArray(parsed.configSuggestions)
      ? (parsed.configSuggestions as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    raw,
  };
}
