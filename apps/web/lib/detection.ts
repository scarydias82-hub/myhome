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
  'bedside table',
  'dining chair',
  'throw cushion',
  'throw blanket',
  'cushion',
  'blanket',
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
  'bedside table': 'Side Tables',
  'dining chair': 'Chairs',
  'throw cushion': 'Decor',
  'throw blanket': 'Decor',
  cushion: 'Decor',
  blanket: 'Decor',
};

export function categoryForLabel(label: string): string {
  return LABEL_TO_CATEGORY[label.toLowerCase()] ?? 'Furniture';
}

// We run TWO Florence-2 calls and merge results:
//   1. Default object-detection — hits the obvious hero items (sofa, bed)
//   2. caption-to-phrase-grounding with a curated noun list — picks up
//      the smaller decor items the default detector tends to miss
// More boxes → a denser picking list, which is the brand promise: every
// visible piece should be shoppable.
const PHRASE_LIST =
  'a sofa, an armchair, a coffee table, a side table, a console, a sideboard, ' +
  'a rug, a floor lamp, a table lamp, a pendant light, ' +
  'art, a picture, a mirror, ' +
  'a potted plant, a vase, a throw cushion, a throw blanket, ' +
  'a bed, a bedside table, a dining table, a dining chair.';

export async function detectObjects(imageUrl: string): Promise<Bbox[]> {
  const client = getFal();
  const [defaultRes, groundedRes] = await Promise.allSettled([
    client.subscribe('fal-ai/florence-2-large/object-detection', {
      input: { image_url: imageUrl },
      logs: false,
    }),
    client.subscribe('fal-ai/florence-2-large/caption-to-phrase-grounding', {
      input: { image_url: imageUrl, text_input: PHRASE_LIST },
      logs: false,
    }),
  ]);

  type RawBox = { x?: number; y?: number; w?: number; h?: number; label?: string };
  const collect = (res: PromiseSettledResult<unknown>): RawBox[] => {
    if (res.status !== 'fulfilled') return [];
    const data = (res.value as { data?: { results?: { bboxes?: RawBox[] } } }).data;
    return data?.results?.bboxes ?? [];
  };

  const all = [...collect(defaultRes), ...collect(groundedRes)];
  return all
    .filter((b) => typeof b.x === 'number' && typeof b.y === 'number' && typeof b.w === 'number' && typeof b.h === 'number')
    .map((b) => ({
      x: b.x!,
      y: b.y!,
      w: b.w!,
      h: b.h!,
      label: (b.label ?? '').toLowerCase().trim(),
    }))
    .filter((b) => b.label.length > 0)
    // Phrase-grounded labels include "a sofa" etc.; trim leading "a "/"an "
    .map((b) => ({ ...b, label: b.label.replace(/^(an?\s+)/, '') }))
    .filter((b) => FURNITURE_LABELS.has(b.label));
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
