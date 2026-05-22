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

type FurnItem = { item: string; condition: string };

// ARCHITECTURE-ONLY preserve directives. Round 16 split the previous
// "preserve everything" approach into two: this function emits only
// the structural bones (floor material, window type, ceiling, door
// locations) that MUST stay. Furniture is handled separately as
// active TRANSFORM directives — the round 15 prompt was preserving
// too much existing decor, which made the render feel like a tint
// not a makeover (user feedback: "nothing really changed").
export function roomFactsToArchitecturalPreserves(
  facts: RoomAnalysis | null | undefined,
): string[] {
  if (!facts) return [];
  const out: string[] = [];

  if (facts.flooring) {
    out.push(
      `Floor SURFACE TYPE stays as "${facts.flooring}" (a new rug ON TOP is fine and encouraged). FORBIDDEN: changing the floor itself to timber, parquet, vinyl, tiles.`,
    );
  }

  if (facts.light?.notes) {
    out.push(
      `Window: keep the SAME window opening as image 1 — ${facts.light.notes}. FORBIDDEN: casement, sash, multi-pane, smaller window, radiator beneath, framed mullions. New curtains in palette tones are encouraged.`,
    );
  }

  const ceiling = facts.existing_colours?.find((c) => c.surface === 'ceiling');
  if (ceiling) {
    out.push(
      `Ceiling: ${ceiling.description}. Stays plain and flat. ABSOLUTELY FORBIDDEN: crown moulding, cornice, architrave, ceiling rose, pendant light, ceiling pendant, ceiling fan, beams, coffers, recessed downlights.`,
    );
  }

  // Architectural features = built-in things (panelled walls, arches,
  // skylights) that are part of the building, not decor. Keep these.
  if (facts.architectural_features?.length) {
    out.push(
      `Preserve these built-in architectural features from image 1: ${facts.architectural_features.join('; ')}.`,
    );
  }

  // Anti-hallucination — Kontext invents rooms behind doors.
  out.push(
    `Through any doorway or opening: show ONLY what is visible in image 1 (unfurnished hallway, wall, void). FORBIDDEN: furnished rooms, beds, art, vases behind doors.`,
  );

  // Open-plan layouts. Without this, Kontext defaults to a bounded
  // box layout — back wall behind the couch, windows on both sides
  // of the room — because closed-plan rooms dominate its training
  // data. Vision flags open-plan zones explicitly; we pipe them
  // verbatim so Kontext can't reinterpret the space as a single
  // enclosed room.
  const openPlanZones = (facts as RoomAnalysis & { open_plan_zones?: string[] })
    .open_plan_zones;
  if (openPlanZones && openPlanZones.length > 0) {
    out.push(
      `OPEN-PLAN LAYOUT — this room is NOT a bounded box. Image 1 shows the space continuing into other zones: ${openPlanZones.join('; ')}. PRESERVE every sight line. ABSOLUTELY FORBIDDEN: adding a back wall behind the sofa/seating, adding partitions or dividers between zones, adding windows where image 1 shows the space continuing into another zone, closing off the kitchen or dining area, narrowing the room to make it feel enclosed. The far end of the visible space MUST remain open and visible exactly as shown in image 1.`,
    );
  }

  // Depth/perspective preservation. Even when Kontext keeps the
  // open layout, it often compresses the depth axis — squeezes the
  // room shorter toward the camera so the back zone reads closer
  // than it is. Image-to-image models don't have native 3D
  // understanding; they reshape pixels to match common interior
  // composition priors. Surfacing the room's actual dimensions
  // (or just naming the ones vision is confident about) anchors
  // the perspective. The metric numbers don't need to be exact —
  // the RATIO + the explicit ban on compression is what bites.
  const dims = facts.dimensions_approximate_m;
  const widthM = dims?.width;
  const depthM = dims?.depth;
  if (widthM != null || depthM != null) {
    const parts: string[] = [];
    if (widthM != null) parts.push(`${widthM}m wide`);
    if (depthM != null) parts.push(`${depthM}m deep`);
    out.push(
      `ROOM PROPORTIONS: image 1 shows a room that is approximately ${parts.join(' × ')}. PRESERVE the camera perspective and depth-of-field. ABSOLUTELY FORBIDDEN: shortening or compressing the depth toward the camera, narrowing the room, moving the far wall/zone closer, telescoping the view to feel more square. The distance from camera to back of frame in the render MUST match image 1.`,
    );
  }

  return out;
}

// ACTIVE TRANSFORM directives — what should change. This is the
// "makeover" half of the prompt. Round 16 makes these much more
// aggressive than round 15: user feedback was "nothing really
// changed" even with palette adherence scoring 7/10. The eval scorer
// rewards palette presence; the user wants visual drama.
export function roomFactsToTransformDirectives(
  facts: RoomAnalysis | null | undefined,
): string[] {
  const out: string[] = [];

  // Existing items the vision flagged as replace candidates.
  if (facts) {
    const replace =
      (facts as RoomAnalysis & { existing_furniture?: FurnItem[] }).existing_furniture
        ?.filter((f) => f.condition === 'replace')
        .map((f) => f.item) ?? [];
    if (replace.length) {
      out.push(
        `REPLACE these items with new pieces in the palette tones — different textures, fabrics, possibly different shapes (not just tinted versions): ${replace.join('; ')}.`,
      );
    }
  }

  // Bed base callout — the round 15 render kept it clinical white
  // even though we said "actively replace". Naming the bed base
  // explicitly + describing the target.
  const isBedroom = (facts?.room_type ?? '').toLowerCase().includes('bedroom');
  if (isBedroom) {
    out.push(
      `BED MAKEOVER: dress the bed completely in palette tones — replace the bed base (no clinical white box), add an upholstered or boucle-textured bedhead, layer the bedding with palette-toned linen quilt + 3-4 cushions of varying sizes and textures + a throw blanket at the foot.`,
    );
  }

  // Standard layering additions for any room — these are the things
  // that turn "a wall repaint" into "a makeover".
  out.push(
    `ADD layering elements: a textured area rug (jute, wool, or palette-toned cotton) under the main furniture; styled accessories on surfaces (ceramics, books, a small plant); a wall art piece or two; floor-length curtains if there are windows.`,
  );

  out.push(
    `The output should feel like a designer styled the room from scratch — meaningful new fabric textures, new accent pieces, new layering. NOT just the same furniture with the wall colour tweaked.`,
  );

  return out;
}

// Back-compat wrapper for code paths that still call the old API.
// The new builder uses the split architecture/transform functions
// above directly.
export function roomFactsToPreserveDirectives(
  facts: RoomAnalysis | null | undefined,
): string[] {
  return roomFactsToArchitecturalPreserves(facts);
}

// Round 16 prompt — split into TRANSFORM-FORWARD + ARCHITECTURE-
// LOCKED sections. User feedback after round 15 production render
// was "nothing really changed in the visual — expected a room
// makeover". The eval scorer rewarded palette presence (palette
// adherence 7/10) but the user perceived the render as too timid.
// Round 16 reframes the prompt so "boldly transform decor" comes
// FIRST and dominates, while architecture preservation is reduced
// to just the bones (floor type, window opening, ceiling shape).
export function buildKontextPrompt({
  basePrompt,
  paletteName,
  roomFacts,
}: {
  basePrompt: string;
  paletteName: string;
  roomFacts?: RoomAnalysis | null;
}): string {
  const preserves = roomFactsToArchitecturalPreserves(roomFacts);
  const transforms = roomFactsToTransformDirectives(roomFacts);

  const sections: string[] = [
    // Lead with the makeover framing + the swatch-visibility fix.
    `BOLD ROOM RESTYLE: transform the room shown in image 1 using the ${paletteName} palette from image 2.`,
    `Image 1 is the SOURCE ROOM to restyle. Image 2 is a COLOUR REFERENCE swatch — use its stripe colours to inform the palette, but DO NOT include the colour stripes as a visible element in the output. The output must show only the restyled room, no swatch, no bands, no colour reference panels.`,
    ``,
    `PALETTE APPLICATION:`,
    `- Walls take the lighter stripe colours from image 2 as the dominant wall paint`,
    `- Soft furnishings (bedding, cushions, curtains, throws) use a mix of light + mid stripe tones`,
    `- Larger furniture upholstery + statement pieces use the deeper stripe tones`,
    `- The render should feel like a meaningful makeover, not a wall repaint`,
    ``,
  ];

  if (transforms.length > 0) {
    sections.push(`ACTIVELY TRANSFORM (this is the makeover — be decisive):`);
    for (const t of transforms) sections.push(`- ${t}`);
    sections.push('');
  }

  if (preserves.length > 0) {
    sections.push(`ARCHITECTURE LOCK (only the bones — change everything else):`);
    for (const p of preserves) sections.push(`- ${p}`);
    sections.push('');
  }

  sections.push(
    `The render MUST look like the SAME ROOM (same walls, windows, ceiling, camera angle) but with VISIBLY different decor — new fabrics, new colours, new accessories, new layering. Do NOT reinterpret it as a different architectural style. Do NOT just tint the existing furniture — replace and layer.`,
    ``,
    `Designer guidance: ${basePrompt.slice(0, 500)}`,
  );

  return sections.join('\n');
}
