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
  // Add your real fixtures here. Examples to copy:
  //
  // {
  //   id: 'bedroom-upstairs',
  //   description: 'Upstairs master bedroom, panelled wall behind bed, late afternoon light',
  //   imageFile: 'bedroom-upstairs.jpg',
  //   style: 'contemporary-au',
  //   paletteId: 'warm-grounded-earth',
  // },
  // {
  //   id: 'living-room-warm',
  //   description: 'North-facing living room, neutral walls, mid-century pieces',
  //   imageFile: 'living-room-warm.jpg',
  //   style: 'japandi',
  //   paletteId: 'misty-blue-neutral',
  // },
  // {
  //   id: 'kitchen-bright',
  //   description: 'Galley kitchen, white cabinetry, single window',
  //   imageFile: 'kitchen-bright.jpg',
  //   style: 'coastal',
  //   paletteId: 'pale-mint-sea-breeze',
  // },
];

export function getFixture(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
