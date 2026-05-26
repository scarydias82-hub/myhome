// Top-down architectural floorplan SVG generator for Mode B's
// confirmation step. Pure function — no IO, no React, no Node-specific
// APIs. Importable from both server and client code.
//
// Input: room dimensions (metres) + room_type from vision analysis.
// Output: SVG string that the FloorplanConfirmation component renders
// via dangerouslySetInnerHTML.
//
// The plan shows:
//   - Room outline at scale (80px per metre), labelled with W/D in m
//   - A "room type" title above the plan
//   - Furniture-placement suggestion boxes for the core categories of
//     that room type — deterministic positioning, not an AI call.
//     Boxes are clipped to stay inside the room outline so unusually
//     small rooms don't render with overflowing suggestions.
//
// The furniture boxes are SUGGESTIONS, not commitments — the user
// hasn't picked products yet at this step. They help the user
// understand the space scale and trust the dimensions before
// proceeding to the picker. Owner directive 2026-05-26: "Dimensions
// + product silhouettes in suggested positions".

export interface FloorplanInput {
  width_m: number;
  depth_m: number;
  /** room_type as vision returns it ("living_room" | "bedroom" |
   *  etc.). null → fall back to the default living-room layout. */
  roomType: string | null;
}

interface FurnitureBox {
  label: string;
  /** Position + size in metres, room-relative (origin = top-left of
   *  the room outline). The renderer converts to pixel space. */
  x_m: number;
  y_m: number;
  w_m: number;
  h_m: number;
}

// Per-room-type deterministic placement of the core categories the
// picker will eventually surface. Coordinates are illustrative —
// roughly "where a sofa typically sits in a living room" — chosen
// to read at first glance, not to be architecturally optimal.
//
// Each function receives the room's (width, depth) in metres and
// returns a list of FurnitureBox suggestions. Clipping to fit the
// room happens after this returns; placement functions can assume
// "average AU room" sizing and the clip step handles edge cases.
type LayoutFn = (width_m: number, depth_m: number) => FurnitureBox[];
const FURNITURE_LAYOUTS: Record<string, LayoutFn> = {
  bedroom: (w, d) => [
    // Queen bed against the back wall, headboard toward y=0.
    { label: 'Bed', x_m: w / 2 - 0.8, y_m: 0.2, w_m: 1.6, h_m: 2.05 },
    // Bedsides flanking.
    { label: 'Bedside', x_m: w / 2 - 1.3, y_m: 0.3, w_m: 0.45, h_m: 0.45 },
    { label: 'Bedside', x_m: w / 2 + 0.85, y_m: 0.3, w_m: 0.45, h_m: 0.45 },
    // Rug under the foot of the bed extending into the room.
    { label: 'Rug', x_m: w / 2 - 1.4, y_m: 1.5, w_m: 2.8, h_m: 1.9 },
  ],
  living_room: (w, d) => [
    // Sofa against the back wall.
    { label: 'Sofa', x_m: w / 2 - 1.1, y_m: 0.3, w_m: 2.2, h_m: 0.95 },
    // Coffee table in front.
    { label: 'Coffee Table', x_m: w / 2 - 0.6, y_m: 1.7, w_m: 1.2, h_m: 0.6 },
    // Side table to the left of the sofa.
    { label: 'Side Table', x_m: 0.3, y_m: 0.5, w_m: 0.45, h_m: 0.45 },
    // Rug grounding the seating area.
    { label: 'Rug', x_m: w / 2 - 1.5, y_m: 1.4, w_m: 3.0, h_m: 2.0 },
  ],
  dining_room: (w, d) => [
    // Dining table centred in the room.
    { label: 'Dining Table', x_m: w / 2 - 1.0, y_m: d / 2 - 0.45, w_m: 2.0, h_m: 0.9 },
    // Rug under the dining table extending past the chairs.
    { label: 'Rug', x_m: w / 2 - 1.5, y_m: d / 2 - 0.85, w_m: 3.0, h_m: 1.7 },
  ],
  kitchen: (w, d) => [
    // Stools at a counter — we don't know where the counter is, so
    // we line them along the back wall as a hint.
    { label: 'Stool', x_m: w / 2 - 0.8, y_m: 0.15, w_m: 0.4, h_m: 0.4 },
    { label: 'Stool', x_m: w / 2 - 0.2, y_m: 0.15, w_m: 0.4, h_m: 0.4 },
    { label: 'Stool', x_m: w / 2 + 0.4, y_m: 0.15, w_m: 0.4, h_m: 0.4 },
  ],
  study: (w, d) => [
    { label: 'Desk', x_m: 0.4, y_m: 0.4, w_m: 1.5, h_m: 0.7 },
    { label: 'Chair', x_m: 0.85, y_m: 1.2, w_m: 0.55, h_m: 0.55 },
    { label: 'Rug', x_m: w / 2 - 1.0, y_m: d - 2.0, w_m: 2.0, h_m: 1.5 },
  ],
  hallway: (w, d) => [
    { label: 'Console', x_m: 0.4, y_m: 0.3, w_m: 1.2, h_m: 0.4 },
    { label: 'Mirror', x_m: 0.7, y_m: 0.05, w_m: 0.6, h_m: 0.05 },
  ],
  outdoor: (w, d) => [
    { label: 'Chairs', x_m: w / 2 - 0.5, y_m: 0.5, w_m: 1.0, h_m: 0.6 },
    { label: 'Rug', x_m: w / 2 - 1.0, y_m: 1.3, w_m: 2.0, h_m: 1.5 },
  ],
  bathroom: (w, d) => [
    { label: 'Tapware', x_m: 0.3, y_m: 0.3, w_m: 0.5, h_m: 0.4 },
    { label: 'Mirror', x_m: 0.4, y_m: 0.05, w_m: 0.4, h_m: 0.05 },
  ],
};

function clipBox(box: FurnitureBox, room_w: number, room_d: number): FurnitureBox {
  // Shrink box if larger than the room itself (rare — only happens
  // for unusually small rooms or oversized illustrative boxes).
  const w_m = Math.min(box.w_m, room_w - 0.2);
  const h_m = Math.min(box.h_m, room_d - 0.2);
  // Clamp position so the box stays inside the room outline with a
  // small visual margin.
  const x_m = Math.max(0.1, Math.min(box.x_m, room_w - w_m - 0.1));
  const y_m = Math.max(0.1, Math.min(box.y_m, room_d - h_m - 0.1));
  return { label: box.label, x_m, y_m, w_m, h_m };
}

function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCase(slug: string | null): string {
  if (!slug) return 'Room';
  return slug
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function generateFloorplanSvg({
  width_m,
  depth_m,
  roomType,
}: FloorplanInput): string {
  // Defensive: zero/negative dimensions can't be rendered. Caller
  // (FloorplanConfirmation component) handles the "no dimensions"
  // case before reaching here, but we double-check.
  if (!Number.isFinite(width_m) || !Number.isFinite(depth_m) || width_m <= 0 || depth_m <= 0) {
    return '';
  }

  // Scale + layout constants. SCALE chosen so a typical AU room
  // (4×3m) renders at ~320×240px — readable on mobile + desktop
  // without hand-wringing about responsive viewBox math.
  const SCALE = 80;
  const PADDING = 50;
  const TITLE_H = 36;
  const w_px = width_m * SCALE;
  const d_px = depth_m * SCALE;
  const total_w = w_px + PADDING * 2;
  const total_h = d_px + PADDING * 2 + TITLE_H;

  const layoutFn: LayoutFn =
    (roomType ? FURNITURE_LAYOUTS[roomType] : undefined) ?? FURNITURE_LAYOUTS.living_room!;
  const boxes = layoutFn(width_m, depth_m).map((b) => clipBox(b, width_m, depth_m));

  const renderBox = (b: FurnitureBox): string => {
    const x_px = PADDING + b.x_m * SCALE;
    const y_px = PADDING + TITLE_H + b.y_m * SCALE;
    const bw = b.w_m * SCALE;
    const bh = b.h_m * SCALE;
    // Label only when the box is large enough to fit it legibly.
    const labelInline =
      bw >= 50 && bh >= 22
        ? `<text x="${x_px + bw / 2}" y="${y_px + bh / 2 + 4}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#3D2E1F">${escapeSvgText(b.label)}</text>`
        : '';
    return `<rect x="${x_px}" y="${y_px}" width="${bw}" height="${bh}" fill="#E8DCC4" stroke="#857462" stroke-width="1" rx="2" />${labelInline}`;
  };

  const title = titleCase(roomType);
  const wLabel = `${width_m.toFixed(1)} m`;
  const dLabel = `${depth_m.toFixed(1)} m`;
  const roomX = PADDING;
  const roomY = PADDING + TITLE_H;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total_w} ${total_h}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floorplan suggestion for ${escapeSvgText(title)}">`,
    // Title
    `<text x="${total_w / 2}" y="22" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="18" fill="#2C1810">${escapeSvgText(title)}</text>`,
    // Room outline
    `<rect x="${roomX}" y="${roomY}" width="${w_px}" height="${d_px}" fill="#FBF7EF" stroke="#3D2E1F" stroke-width="2" />`,
    // Furniture suggestions
    boxes.map(renderBox).join(''),
    // Width dimension label (above the room)
    `<text x="${roomX + w_px / 2}" y="${roomY - 8}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#857462">${wLabel}</text>`,
    // Depth dimension label (to the left of the room, rotated)
    `<text x="${roomX - 18}" y="${roomY + d_px / 2}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#857462" transform="rotate(-90 ${roomX - 18} ${roomY + d_px / 2})">${dLabel}</text>`,
    `</svg>`,
  ].join('');
}
