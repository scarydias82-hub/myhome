// Eval fixture manifest. Each entry tests one (room photo × style ×
// palette) combination through the full render pipeline. Drop your
// room photos into ./fixtures/ and reference them by filename here.
//
// Multiple entries per image is fine — that's how we compare config
// behaviour across styles or palettes for the same room.

export interface Fixture {
  id: string;
  description: string;
  imageFile: string; // relative to apps/web/scripts/eval/fixtures/
  style: string; // see apps/web/lib/styles.ts STYLES
  paletteId: string; // see apps/web/lib/palettes.json
}

export const FIXTURES: Fixture[] = [
  {
    id: 'bedroom-upstairs',
    description: 'Upstairs bedroom, panelled wall behind bed',
    // 5712×4284 camera-original JPEG, 4:3 — no letterbox bars (the
    // previous master_bed.PNG was a 2532×1170 real-estate-website
    // screenshot with ~38% black-bar contamination that broke canny
    // edge detection and aspect-ratio derivation).
    imageFile: 'bedroom_test.jpg',
    style: 'contemporary-au',
    paletteId: 'warm-grounded-earth',
  },
];

export function getFixture(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
