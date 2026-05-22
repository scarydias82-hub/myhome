// Retailer → market-segment lookup. Single source of truth for the
// budget-tier tag that every product record carries through ingest into
// products.market_segment, where global user preferences ("show me
// budget options") can filter against it.
//
// Six tiers, anchored to the AU furniture market and sofa-priced for
// reference (segments still apply to chairs, lamps, rugs, etc. — sofa
// price is the most consumer-recognisable anchor):
//
//   ultra-budget  — Kmart, Target. Accent + decor pieces only.
//                   No serious sofa offering.
//   budget        — Fantastic, IKEA. Sofas $400–$1,200.
//                   Flat-pack / particleboard.
//   budget-mid    — Amart. Sofas $700–$1,500. Mixed materials.
//   mid           — Brosa (online-only mid). Sofas $700–$1,500
//                   with designer-inspired styling. Mid-tier
//                   homewares retailers (Adairs, Beacon Lighting,
//                   Carpet Court, Choices Flooring, Tile Cloud)
//                   land here for their non-sofa categories.
//   upper-mid     — Freedom, Koala. Sofas $1,500–$4,000+.
//                   Solid timber, custom fabrics.
//   premium       — Poliform, Coco Republic, GlobeWest, Woodcut,
//                   The Rug Establishment, Signorino, ABI Interiors.
//                   Designer / luxury / trade-grade.
//
// Paint (Dulux) is intentionally untagged — market-segment is a
// furniture-purchase concept, not a paint one.

export const SEGMENTS = /** @type {const} */ ([
  'ultra-budget',
  'budget',
  'budget-mid',
  'mid',
  'upper-mid',
  'premium',
]);

// Map keyed by the exact `retailer` string each scraper writes into
// its product records (i.e. the `RETAILER` constant in each scraper
// file). Keep in sync when adding a new retailer.
const RETAILER_SEGMENT = {
  // ultra-budget — none scraped yet

  // budget
  'Fantastic Furniture': 'budget',

  // budget-mid — none scraped yet

  // mid
  'Brosa': 'mid',
  'Adairs': 'mid',
  'Beacon Lighting': 'mid',
  'Carpet Court': 'mid',
  'Choices Flooring': 'mid',
  'Tile Cloud': 'mid',

  // upper-mid
  'Freedom': 'upper-mid',
  'Koala': 'upper-mid',

  // premium
  'Poliform': 'premium',
  'Coco Republic': 'premium',
  'GlobeWest': 'premium',
  'Woodcut': 'premium',
  'The Rug Est': 'premium',
  'Signorino': 'premium',
  'ABI Interiors': 'premium',

  // intentionally untagged — paint isn't a budget-tier purchase
  'Dulux': null,
};

/**
 * @param {string} retailer
 * @returns {(typeof SEGMENTS)[number] | null}
 */
export function segmentFor(retailer) {
  if (!retailer) return null;
  const v = RETAILER_SEGMENT[retailer];
  return v === undefined ? null : v;
}
