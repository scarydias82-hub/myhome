// Pure derivation of style/room/mood tags from a product's palette
// matches + category. No Claude calls — we lean on the rich tag data
// already baked into apps/web/lib/palettes.json (every palette carries
// style_tags + recommended_rooms + a vibe string), so once we know
// which palettes a product belongs to we can compute the rest by union.
//
// Returned tags are persisted on products.style_tags / room_tags /
// mood_tags and used by lib/matching.ts to filter the candidate pool
// before the Claude vision ranker runs.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALETTES_PATH = path.resolve(__dirname, '../../web/lib/palettes.json');

const palettesJson = JSON.parse(await readFile(PALETTES_PATH, 'utf-8'));
const PALETTES_BY_ID = new Map(palettesJson.palettes.map((p) => [p.id, p]));

// Category → rooms it naturally belongs in. Augments the palette-derived
// rooms: a sofa might be tagged for living_room by every palette it
// matches, but a bed needs to land in bedroom no matter the palette.
// Rooms here use the same slug shape as palette.recommended_rooms (snake
// case) so the union is consistent.
//
// Scope-of-room rule: list every room the category PLAUSIBLY fits. The
// matcher uses `room_tags @> ARRAY[$room]` so being conservative here
// hides products from rooms they'd actually work in. Being generous
// just leaves the final visual-similarity ranker to do its job.
const CATEGORY_TO_ROOMS = {
  // Living-room-first soft goods
  Sofas: ['living_room', 'study'],
  Sofa: ['living_room', 'study'],
  Armchair: ['living_room', 'bedroom', 'study'],
  Chairs: ['living_room', 'bedroom', 'study', 'dining_room'],
  Chair: ['living_room', 'bedroom', 'study', 'dining_room'],
  'Coffee Tables': ['living_room'],
  'Coffee Table': ['living_room'],
  Ottomans: ['living_room', 'bedroom'],
  Ottoman: ['living_room', 'bedroom'],

  // Bedroom
  Beds: ['bedroom'],
  Bed: ['bedroom'],
  'Bedside Table': ['bedroom'],
  'Bedside Tables': ['bedroom'],
  'Quilt Covers': ['bedroom'],

  // Dining
  'Dining Tables': ['dining_room', 'kitchen'],
  'Dining Chairs': ['dining_room', 'kitchen'],
  'Dining Table': ['dining_room', 'kitchen'],

  // Multi-room
  'Side Tables': ['living_room', 'bedroom', 'study'],
  'Occasional Tables': ['living_room', 'bedroom'],
  Cushions: ['living_room', 'bedroom'],
  Throws: ['living_room', 'bedroom'],
  Rugs: ['living_room', 'bedroom', 'dining_room', 'study'],

  // Whole-home — list every room so the matcher's intersection works
  Lighting: ['living_room', 'bedroom', 'dining_room', 'kitchen', 'study', 'hallway', 'bathroom'],
  Mirrors: ['living_room', 'bedroom', 'dining_room', 'hallway', 'bathroom'],
  Art: ['living_room', 'bedroom', 'dining_room', 'study', 'hallway'],
  Curtains: ['bedroom', 'living_room', 'study'],
  'Curtains - Sheers': ['bedroom', 'living_room', 'study'],
  'Curtains - Blockout': ['bedroom', 'living_room', 'study'],

  // Storage
  Consoles: ['living_room', 'hallway'],
  'Console Table': ['living_room', 'hallway'],
  Sideboards: ['dining_room', 'living_room'],
  'Entertainment Units': ['living_room'],
  Bookcases: ['study', 'living_room'],
  'Storage & Desks': ['study', 'bedroom'],
  'Storage System': ['study', 'bedroom'],
  Desks: ['study'],
  Wardrobe: ['bedroom'],

  // Paint is room-agnostic — let it match any room. Use the 'any'
  // sentinel so the matcher can OR against it (see matching.ts).
  Paint: ['any'],

  // Carpet & flooring — generally living/bedroom, sometimes whole-home
  Carpet: ['living_room', 'bedroom', 'study'],
  Carpets: ['living_room', 'bedroom', 'study'],
  Flooring: ['living_room', 'bedroom', 'dining_room', 'kitchen', 'study'],
  Tiles: ['kitchen', 'bathroom'],
};

function categoryRooms(category) {
  if (!category) return [];
  return CATEGORY_TO_ROOMS[category] ?? [];
}

// Tokenise a palette's `vibe` string into mood slugs.
// "Cocooning · Natural · Sophisticated" → ["cocooning", "natural", "sophisticated"]
function vibeTokens(vibe) {
  if (!vibe) return [];
  return String(vibe)
    .split(/[·•·]/) // middle dot, bullet, etc.
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean);
}

// Main entry — given palette matches + category, return the three tag
// arrays the products table will persist. All three are deduped + sorted
// for stable diffs in backfills.
export function deriveTags({ paletteTags, category }) {
  const styleSet = new Set();
  const roomSet = new Set();
  const moodSet = new Set();

  for (const paletteId of paletteTags ?? []) {
    const p = PALETTES_BY_ID.get(paletteId);
    if (!p) continue;
    for (const s of p.style_tags ?? []) styleSet.add(s);
    for (const r of p.recommended_rooms ?? []) roomSet.add(r);
    for (const m of vibeTokens(p.vibe)) moodSet.add(m);
  }

  for (const r of categoryRooms(category)) roomSet.add(r);

  return {
    style_tags: [...styleSet].sort(),
    room_tags: [...roomSet].sort(),
    mood_tags: [...moodSet].sort(),
  };
}

// Exposed so tests / scripts can introspect the lookup map without
// re-reading palettes.json.
export const PALETTE_INDEX = PALETTES_BY_ID;
