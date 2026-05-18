// Object detection via fal.ai Florence-2. Returns labelled bounding boxes in
// pixel coordinates relative to the input image. We use this on the rendered
// room photo to find shoppable items (sofa, chair, coffee table, rug, lamp,
// art) for the picking list.

import { getFal } from '@/lib/fal';

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

// Florence-2's open-vocab detection accepts a free-text task prompt.
// "Locate the objects with category name in the image." is the documented
// way to drive multi-class detection, but Florence-2 also returns a default
// COCO-style detection when called with no prompt. We use the default and
// then filter for furniture-relevant labels.
const FURNITURE_LABELS = new Set([
  'sofa',
  'couch',
  'chair',
  'armchair',
  'bench',
  'stool',
  'ottoman',
  'bed',
  'table',
  'coffee table',
  'dining table',
  'side table',
  'rug',
  'lamp',
  'floor lamp',
  'table lamp',
  'pendant light',
  'mirror',
  'art',
  'picture',
  'painting',
  'plant',
  'potted plant',
  'vase',
  'shelf',
  'cabinet',
  'console',
  'sideboard',
]);

// Map raw detection labels to a normalised category we can filter products by.
const LABEL_TO_CATEGORY: Record<string, string> = {
  sofa: 'Sofas',
  couch: 'Sofas',
  chair: 'Chairs',
  armchair: 'Chairs',
  bench: 'Chairs',
  stool: 'Chairs',
  ottoman: 'Ottomans',
  bed: 'Beds',
  table: 'Tables',
  'coffee table': 'Coffee Tables',
  'dining table': 'Dining',
  'side table': 'Side Tables',
  rug: 'Rugs',
  lamp: 'Lighting',
  'floor lamp': 'Lighting',
  'table lamp': 'Lighting',
  'pendant light': 'Lighting',
  mirror: 'Mirrors',
  art: 'Art',
  picture: 'Art',
  painting: 'Art',
  plant: 'Furniture',
  'potted plant': 'Furniture',
  vase: 'Furniture',
  shelf: 'Storage & Desks',
  cabinet: 'Storage & Desks',
  console: 'Consoles',
  sideboard: 'Sideboards',
};

export function categoryForLabel(label: string): string {
  return LABEL_TO_CATEGORY[label.toLowerCase()] ?? 'Furniture';
}

export async function detectObjects(imageUrl: string): Promise<Bbox[]> {
  const client = getFal();
  const result = await client.subscribe('fal-ai/florence-2-large/object-detection', {
    input: { image_url: imageUrl },
    logs: false,
  });
  const raw = result.data as {
    results?: { bboxes?: Array<{ x: number; y: number; w: number; h: number; label: string }> };
  };
  const bboxes = raw.results?.bboxes ?? [];
  return bboxes
    .filter((b) => FURNITURE_LABELS.has(b.label.toLowerCase()))
    .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, label: b.label.toLowerCase() }));
}

// Florence-2 sometimes returns two near-duplicate boxes for the same item
// (e.g. "sofa" + "couch"). Collapse overlapping boxes that share a category.
export function dedupeBoxes(boxes: Bbox[], iouThreshold = 0.5): Bbox[] {
  const out: Bbox[] = [];
  for (const b of boxes) {
    let merged = false;
    for (const o of out) {
      if (categoryForLabel(b.label) !== categoryForLabel(o.label)) continue;
      if (iou(b, o) < iouThreshold) continue;
      // Keep the larger box.
      if (b.w * b.h > o.w * o.h) {
        o.x = b.x;
        o.y = b.y;
        o.w = b.w;
        o.h = b.h;
        o.label = b.label;
      }
      merged = true;
      break;
    }
    if (!merged) out.push({ ...b });
  }
  return out;
}

function iou(a: Bbox, b: Bbox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua === 0 ? 0 : inter / ua;
}
