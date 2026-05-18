// Orchestrator. Runs each retailer sequentially (never in parallel — we
// want politeness and one source of network pressure at a time).

import { scrapePoliform } from './poliform.js';
import { scrapeCocoRepublic } from './cocoRepublic.js';
import { scrapeGlobeWest } from './globeWest.js';

const SCRAPERS = [
  { name: 'Poliform', run: scrapePoliform },
  { name: 'Coco Republic', run: scrapeCocoRepublic },
  { name: 'GlobeWest', run: scrapeGlobeWest },
];

const started = Date.now();
const summary = [];

for (const { name, run } of SCRAPERS) {
  console.log(`\n=== ${name} ===`);
  try {
    const result = await run();
    const productCount = result?.products?.length ?? 0;
    const imageCount = (result?.products ?? []).filter((p) => p?.images?.downloaded).length;
    const errorCount = result?.errors?.length ?? 0;
    summary.push({ retailer: name, products: productCount, images: imageCount, errors: errorCount });
  } catch (err) {
    console.error(`${name} crashed:`, err);
    summary.push({ retailer: name, products: 0, images: 0, errors: 1, crashed: true });
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n=== Summary ===');
for (const row of summary) {
  const status = row.crashed ? '✗' : row.products > 0 ? '✓' : '–';
  console.log(`  ${status} ${row.retailer}: ${row.products} products, ${row.images} images, ${row.errors} errors`);
}
console.log(`Output written to ./output/  (took ${seconds}s)`);
