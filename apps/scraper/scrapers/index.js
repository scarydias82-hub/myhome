// Orchestrator. Runs every retailer scraper IN PARALLEL via
// Promise.allSettled so:
//   - one retailer's failure doesn't take down the batch
//   - total wall-time is bound by the slowest scraper, not the sum
//   - we can test catalog expansion ideas quickly
//
// Each scraper handles its own internal politeness (delay between
// requests, robots.txt checks). Image downloads stay sequential inside
// each scraper to avoid hammering retailer CDNs.

import { scrapePoliform } from './poliform.js';
import { scrapeCocoRepublic } from './cocoRepublic.js';
import { scrapeGlobeWest } from './globeWest.js';
import { scrapeKoala } from './koala.js';
import { scrapeBeaconLighting } from './beaconLighting.js';
import { scrapeFreedom } from './freedom.js';
import { scrapeDulux } from './dulux.js';
import { scrapeWoodcut } from './woodcut.js';
import { scrapeAdairs } from './adairs.js';
import { scrapeCarpetCourt } from './carpetCourt.js';

const SCRAPERS = [
  { name: 'Poliform', run: scrapePoliform },
  { name: 'Coco Republic', run: scrapeCocoRepublic },
  { name: 'GlobeWest', run: scrapeGlobeWest },
  { name: 'Koala', run: scrapeKoala },
  { name: 'Beacon Lighting', run: scrapeBeaconLighting },
  { name: 'Freedom', run: scrapeFreedom },
  { name: 'Dulux', run: scrapeDulux },
  { name: 'Woodcut', run: scrapeWoodcut },
  { name: 'Adairs', run: scrapeAdairs },
  { name: 'Carpet Court', run: scrapeCarpetCourt },
];

const started = Date.now();
console.log(`\nrunning ${SCRAPERS.length} scrapers in parallel...\n`);

const settled = await Promise.allSettled(
  SCRAPERS.map(async ({ name, run }) => {
    try {
      const result = await run();
      return { name, result };
    } catch (err) {
      // Surface the crash but rethrow so Promise.allSettled marks it
      // rejected — the summary loop below renders the ✗ row for it.
      console.error(`[${name}] crashed:`, err?.message ?? err);
      throw err;
    }
  }),
);

const summary = settled.map((s, i) => {
  const name = SCRAPERS[i].name;
  if (s.status === 'rejected') {
    return { retailer: name, products: 0, images: 0, errors: 1, crashed: true };
  }
  const r = s.value.result;
  const products = r?.products ?? [];
  return {
    retailer: name,
    products: products.length,
    images: products.filter((p) => p?.images?.downloaded).length,
    errors: r?.errors?.length ?? 0,
  };
});

const totalProducts = summary.reduce((s, r) => s + r.products, 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log('\n=== Summary ===');
for (const row of summary) {
  const status = row.crashed ? '✗' : row.products > 0 ? '✓' : '–';
  console.log(`  ${status} ${row.retailer.padEnd(18)} ${row.products.toString().padStart(4)} products · ${row.images} images · ${row.errors} errors`);
}
console.log(`\n  total: ${totalProducts} products across ${SCRAPERS.length} retailers (${seconds}s wall-time)`);
console.log(`  output: ./output/<retailer>/products.json`);
console.log(`  next: pnpm ingest\n`);
