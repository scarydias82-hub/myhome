// Kontext prompt builder — shared between /api/render and the eval
// pipeline so production + eval test the same string.
//
// Background: fal-ai/flux-pro/kontext/multi is a natural-language
// compositional editor. It takes 2+ images via `image_urls` and a
// prompt describing roles + transformations. Unlike flux-general it
// has NO canny ControlNet, so the prompt does ALL the geometry-
// preservation work. Generic preservation language ("preserve
// architecture") is too loose — Kontext fills style-adjacent gaps
// with whatever fits its read of the aesthetic (warm earth palette
// → cottage windows, parquet floor, crown moulding).
//
// The fix: pipe per-fixture vision facts (RoomAnalysis from
// lib/vision.ts) into the prompt as explicit "MUST preserve" / "do
// NOT replace with X, Y, Z" lines. This makes Kontext aware of the
// source room's actual architectural style so it can't reinterpret.

import type { RoomAnalysis } from './vision';

// Build the per-room preserve directives from the existing Claude
// vision analysis. Round 14 used the looser version of these
// directives and broke 5.0 average for the first time across 15
// render iterations. Round 15 strengthens the NEGATIVE language for
// the recurring failures (ceiling moulding, pendant lights, window
// type swaps) and adds an active bedding-replacement directive.
export function roomFactsToPreserveDirectives(
  facts: RoomAnalysis | null | undefined,
): string[] {
  if (!facts) return [];
  const out: string[] = [];

  if (facts.flooring) {
    out.push(
      `Floor: MUST remain "${facts.flooring}". FORBIDDEN: timber, parquet, vinyl, polished concrete, tiles, floorboards, or any material change.`,
    );
  }

  // Window description lives in light.notes — e.g. "Large window with
  // floor-to-ceiling curtains; light appears morning sun".
  if (facts.light?.notes) {
    out.push(
      `Window: MUST keep the EXACT same window as image 1 — ${facts.light.notes}. FORBIDDEN: casement, sash, multi-pane, smaller window, radiator beneath window, framed mullions. The window MUST stay the same SIZE and FRAME STYLE.`,
    );
  }

  // Ceiling — extract from existing_colours so Kontext doesn't add
  // ornamental period features. Round 14 still added crown moulding
  // despite a directive, so this version is more emphatic.
  const ceiling = facts.existing_colours?.find((c) => c.surface === 'ceiling');
  if (ceiling) {
    out.push(
      `Ceiling: ${ceiling.description}. The ceiling MUST stay plain and flat. ABSOLUTELY FORBIDDEN: crown moulding, cornice, architrave, ceiling rose, pendant light, ceiling pendant, ceiling fan, beams, coffers, recessed downlights — none of these exist in image 1 and they MUST NOT be added.`,
    );
  }

  if (facts.architectural_features?.length) {
    out.push(
      `Preserve these architectural features exactly as shown in image 1: ${facts.architectural_features.join('; ')}.`,
    );
  }

  // Keep-list from furniture: items the designer wants preserved
  // exactly. The render must show these in the same shape/position.
  type FurnItem = { item: string; condition: string };
  const keep = (facts as RoomAnalysis & { existing_furniture?: FurnItem[] }).existing_furniture
    ?.filter((f) => f.condition === 'keep')
    .map((f) => f.item) ?? [];
  if (keep.length) {
    out.push(`Must remain in the render with the same shape and position: ${keep.join('; ')}.`);
  }

  // Active replace-list: items the designer wants swapped. Round 14
  // left the existing burnt-orange bedding untouched ("contradicting
  // the designer's instruction to break the beige-on-beige sameness"
  // per the evaluator). Make the replacement directive active not
  // implicit.
  const replace = (facts as RoomAnalysis & { existing_furniture?: FurnItem[] }).existing_furniture
    ?.filter((f) => f.condition === 'replace')
    .map((f) => f.item) ?? [];
  if (replace.length) {
    out.push(
      `ACTIVELY REPLACE these items with new pieces in the palette tones: ${replace.join('; ')}. These should look meaningfully different — new textures, new fabrics, new shapes — not just colour-tinted versions of the originals.`,
    );
  }

  // Generic anti-hallucination — Kontext loves to "complete" a scene
  // by inventing rooms behind doorways.
  out.push(
    `Through any doorway or opening: show ONLY what is visible in image 1 (typically an unfurnished dark hallway, a wall, or a void). FORBIDDEN: furnished rooms, beds, art, vases, or any decorative scene through doors.`,
  );

  return out;
}

// Build the full Kontext prompt. Round 15 structure: lead with the
// concrete palette instruction (Kontext pays most attention to the
// opening), then preserve directives, then designer-style guidance.
export function buildKontextPrompt({
  basePrompt,
  paletteName,
  roomFacts,
}: {
  basePrompt: string;
  paletteName: string;
  roomFacts?: RoomAnalysis | null;
}): string {
  const preserves = roomFactsToPreserveDirectives(roomFacts);
  const sections: string[] = [
    `Restyle the room shown in image 1 using the ${paletteName} palette shown as colour stripes in image 2.`,
    `Image 1 is the source room. Image 2 is the palette swatch reference.`,
    ``,
    `Apply the palette from image 2:`,
    `- Walls take the top stripe colour (the largest band)`,
    `- Soft furnishings — bedding, cushions, throws, curtains — take the lighter stripe tones`,
    `- Larger furniture and accents take the deeper stripe tones`,
    ``,
  ];

  if (preserves.length > 0) {
    sections.push(`STRUCTURAL PRESERVATION (facts about image 1 that MUST be honoured):`);
    for (const p of preserves) sections.push(`- ${p}`);
    sections.push('');
  }

  sections.push(
    `The render MUST look like the SAME ROOM with new colours and new soft furnishings. Do NOT reinterpret it as a different architectural style (cottage, period, industrial, mid-century etc.). Do NOT change the camera angle, viewpoint, or room footprint.`,
    ``,
    `Additional designer guidance: ${basePrompt.slice(0, 600)}`,
  );

  return sections.join('\n');
}
