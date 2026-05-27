// Mode C prompt builder. Targets SDXL through ComfyUI's Depth ControlNet
// pipeline (see lib/comfyui-workflows.ts).
//
// Important difference from Mode A / Mode B (buildOpenAIImagePrompt /
// buildModeBPrompt in lib/openai-image.ts):
//   - SDXL through CLIP text encoder takes ~77 tokens of effective
//     attention. Verbose prose directives (the kind gpt-image-1 reads
//     well) get truncated. The format that survives best is short,
//     comma-separated descriptors that frontload the most important
//     content.
//   - No "Image 1 ... Image 2 ..." references — SDXL doesn't accept
//     reference images at all in Stage 3a. Products go in the prompt
//     as descriptive text (silhouette + material + colour). Stage 3b
//     will layer IP-Adapter visual conditioning per product.
//   - No "preserve the room architecture" directive needed — Depth
//     ControlNet enforces room geometry at the model level. The
//     prompt's only job is to describe what should occupy that
//     geometry stylistically.
//
// The negative prompt is a separate field on the SDXL pipeline (not
// just text inside the positive) — KSampler conditions on both, with
// the negative pushing the latent away from those concepts at each
// sampling step. We use a baseline of typical SDXL artifact terms
// plus a few myMaison-specific anti-patterns (no text overlays,
// no cartoon styling).

import type { RoomAnalysis } from '@/lib/vision';

export interface ModeCProductRef {
  name: string;
  category: string;
  retailer: string;
  /** vision_profile-derived physical descriptor, e.g.
   *  "low-profile modern armchair with curved arms and round
   *  upholstered seat". Falls back to category when missing. */
  silhouette?: string | null;
  /** Scraped product dimensions (cm). Currently informational
   *  only — SDXL doesn't honour numerical sizes well inside a
   *  short prompt, so we drop them unless we later find them
   *  load-bearing. */
  dimensions?: {
    width_cm?: number | null;
    depth_cm?: number | null;
    height_cm?: number | null;
  } | null;
}

export interface BuildModeCPromptInput {
  paletteName: string;
  paletteVibe?: string | null;
  styleName: string;
  roomType?: string | null;
  productRefs?: ModeCProductRef[];
  /** Decorative wall features (panelling, cornicing, picture rails).
   *  Named into the prompt so the diffusion process doesn't smooth
   *  them away — depth controlnet locks their geometry but the
   *  appearance of "wood panelling" vs "flat painted wall" is a
   *  prompt-domain decision the controlnet doesn't enforce. */
  architecturalFeatures?: string[];
}

export interface ModeCPrompts {
  positive: string;
  negative: string;
}

// Comma-separated SDXL anti-prompt. Stays under the CLIP attention
// window. Order matters slightly — higher-weight concepts go first.
// Curated for myMaison's interior-render use case: artefact terms
// + cartoon/illustration suppressors + low-quality flags.
const MODE_C_NEGATIVE_BASELINE = [
  'blurry',
  'low quality',
  'jpeg artifacts',
  'watermark',
  'text',
  'caption',
  'signature',
  'deformed',
  'distorted',
  'oversaturated',
  'cartoon',
  'illustration',
  'painting',
  'sketch',
  'render',
  '3d render',
  'cgi',
  'unrealistic',
  'duplicate furniture',
  'extra furniture',
].join(', ');

/** Build positive + negative prompts for Mode C SDXL rendering.
 *
 *  Returns prompts already token-budgeted for SDXL's ~77-token CLIP
 *  encoder window — verbose inputs get pruned to the highest-value
 *  descriptors. The depth controlnet handles room-geometry
 *  preservation, so the prompt focuses on:
 *    1. Aesthetic anchor (style + palette + vibe)
 *    2. Product descriptions (silhouette + material per pick)
 *    3. Architectural features worth preserving stylistically
 *    4. Editorial-photography quality cues at the tail */
export function buildModeCPrompt(input: BuildModeCPromptInput): ModeCPrompts {
  const parts: string[] = [];

  // 1. Room type + style + palette — the aesthetic anchor. SDXL
  //    weighs early tokens more heavily, so palette + style come first.
  const roomTypeWord = (input.roomType ?? 'interior').replace(/_/g, ' ');
  parts.push(`a ${input.styleName.toLowerCase()} ${roomTypeWord}`);
  parts.push(`${input.paletteName.toLowerCase()} palette`);
  if (input.paletteVibe) {
    parts.push(input.paletteVibe.toLowerCase());
  }

  // 2. Products — keep at most 4 to stay within the attention window,
  //    cap each descriptor short. Silhouette field is already a
  //    concise visual phrase from the vision profile, so we use it
  //    verbatim. Category falls back as a last resort.
  const products = (input.productRefs ?? []).slice(0, 4);
  for (const p of products) {
    const desc = p.silhouette?.trim() || p.category;
    // Trim to keep individual product descriptors compact —
    // SDXL CLIP truncates mid-sentence which can drop a critical
    // material word. Bound each descriptor to ~80 chars.
    parts.push(desc.slice(0, 80));
  }

  // 3. Architectural features worth styling — these are
  //    depth-locked by ControlNet (the geometry survives) but the
  //    surface material is a prompt-domain choice. e.g. "wood-
  //    panelled feature wall" anchors the panelling's appearance
  //    even though ControlNet locks where it is.
  const features = (input.architecturalFeatures ?? []).slice(0, 3);
  for (const f of features) {
    parts.push(f.toLowerCase());
  }

  // 4. Editorial photography quality cues — these reliably push
  //    SDXL toward magazine-shot aesthetics without overwhelming
  //    the earlier content tokens. Order tuned: "editorial" is
  //    the strongest anchor for the look we want, "natural light"
  //    counters SDXL's tendency to render harsh studio lighting.
  parts.push('editorial interior photography');
  parts.push('natural light');
  parts.push('magazine quality');
  parts.push('photorealistic');
  parts.push('high detail');

  const positive = parts.join(', ');

  return {
    positive,
    negative: MODE_C_NEGATIVE_BASELINE,
  };
}

/** Adapter that takes the same RoomAnalysis blob the /api/render
 *  route already pulls from `rooms.analysis`, and extracts the
 *  bits Mode C prompts need. Keeps the route's call site short. */
export function modeCPromptFromAnalysis(
  analysis: RoomAnalysis | null,
  base: Omit<BuildModeCPromptInput, 'roomType' | 'architecturalFeatures'>,
): ModeCPrompts {
  return buildModeCPrompt({
    ...base,
    roomType: analysis?.room_type ?? null,
    architecturalFeatures: analysis?.architectural_features ?? [],
  });
}
