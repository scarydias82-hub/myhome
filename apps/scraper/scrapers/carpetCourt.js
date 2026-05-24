// Carpet Court — Australian flooring + window-furnishings retailer
// running on Magento 2. Robots.txt declares Crawl-delay: 5 so we honour
// it (5500ms between requests). Sitemap is mostly blog content — actual
// products live behind faceted category pages.
//
// Strategy: walk a small set of curated category PLPs (room-based for
// carpet, type-based for curtains), extract `.product-item` cards
// directly from the listing — no per-product visit needed because the
// PLP card already carries title (product-item-link text), image
// (product-image-photo src), and product URL. Dedupe by URL because
// products appear under multiple room filters.
//
// Replaces both the cancelled Carpet Call task (#86 — 403'd everything
// behind Cloudflare) and the Spotlight half of the original #80 brief
// for curtains/sheers.
//
// Scope:
//   IN  — carpets (broadloom), sheer curtains, blockout/blackout curtains
//   OUT — underlay, accessories, fitting kits, quote-only items, blinds
//         (separate retailer brief)
//
// Pricing: carpets are sold per m² (no flat price). We store price=null;
// the UI surfaces a "Visit retailer for quote" CTA in that case.
// Palette filter runs downstream at ingest.

import path from 'node:path';
import { chromium } from 'playwright';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.carpetcourt.com.au';
const RETAILER = 'Carpet Court';
const RETAILER_SLUG = 'carpet-court';

// 5s per robots.txt — slightly padded.
const CRAWL_DELAY_MS = 5500;
const TARGET_MAX = 120;

// Each tuple: PLP path + display category + optional room tag.
// Carpet PLPs are walked per-room so we can capture room suitability
// (a single carpet often appears under bedroom + living-room + hallway
// — keep all, don't dedup-and-lose). Curtain PLPs have no room.
const PLPS = [
  { path: '/carpet/room/bedroom', category: 'Carpet', room: 'bedroom' },
  { path: '/carpet/room/living-room', category: 'Carpet', room: 'living-room' },
  { path: '/carpet/room/hallway', category: 'Carpet', room: 'hallway' },
  { path: '/carpet/room/kids', category: 'Carpet', room: 'kids' },
  { path: '/carpet/room/stairs', category: 'Carpet', room: 'stairs' },
  // /carpet/room/study returns 0 products as of 2026-05-20 — Carpet
  // Court doesn't currently tag any range for studies. Re-enable if
  // they add stock to that filter.
  { path: '/curtains/sheers', category: 'Curtains - Sheers', room: null },
  { path: '/curtains/blockout', category: 'Curtains - Blockout', room: null },
  { path: '/curtains/', category: 'Curtains', room: null },
];

const EXCLUDE_PATTERNS =
  /(underlay|accessory|fitting[-\s]?kit|installation|quote[-\s]?only|sample[-\s]?only|gift[-\s]?card)/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugFromUrl(url) {
  return String(url)
    .replace(/\/$/, '')
    .split('/')
    .pop()
    .slice(0, 90);
}

// Magento renders the product image with /media/catalog/product/ as the
// canonical path. The PLP variant comes with ?optimize=medium params —
// strip them for the original full-size asset (better for sharp
// dominant-colour extraction at ingest time).
function canonicalImage(src) {
  if (!src) return null;
  const noQuery = src.split('?')[0];
  return noQuery;
}

async function extractCardsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.product-item')];
    return cards.map((card) => {
      const linkEl = card.querySelector('a.product-item-link');
      const imgEl = card.querySelector('img.product-image-photo');
      const productUrl = linkEl?.getAttribute('href') ?? null;
      const name = linkEl?.innerText?.trim() ?? null;
      const imgSrc = imgEl?.getAttribute('src') ?? null;
      const imgAlt = imgEl?.getAttribute('alt') ?? null;
      return { productUrl, name, imgSrc, imgAlt };
    });
  });
}

export async function scrapeCarpetCourt() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(`${ORIGIN}/carpet/`))) {
    console.warn(`[${RETAILER}] robots.txt disallows /carpet/, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets — we don't need fonts/images/CSS on the PLP
    // walks. Image downloads happen via Node fetch in downloadImage().
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet')
        return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // Walk PLPs. Keyed by product URL so when a carpet appears under
    // multiple /carpet/room/* filters we merge the rooms into a single
    // entry instead of losing all but the first.
    const byUrl = new Map(); // productUrl -> { ...card, category, rooms: Set }
    for (let i = 0; i < PLPS.length; i++) {
      const plp = PLPS[i];
      const url = `${ORIGIN}${plp.path}`;
      if (!(await isAllowed(url))) {
        console.warn(`[${RETAILER}] robots disallows ${url}, skipping`);
        continue;
      }
      if (i > 0) await sleep(CRAWL_DELAY_MS); // honour Crawl-delay: 5
      console.log(`[${RETAILER}] PLP: ${plp.path} (${plp.category}${plp.room ? ` · room=${plp.room}` : ''})`);
      try {
        const cards = await extractCardsFromPage(page, url);
        let added = 0;
        let merged = 0;
        for (const c of cards) {
          if (!c.productUrl || !c.name) continue;
          if (EXCLUDE_PATTERNS.test(c.productUrl) || EXCLUDE_PATTERNS.test(c.name)) continue;
          let entry = byUrl.get(c.productUrl);
          if (!entry) {
            entry = { ...c, category: plp.category, rooms: new Set() };
            byUrl.set(c.productUrl, entry);
            added++;
          } else {
            merged++;
          }
          if (plp.room) entry.rooms.add(plp.room);
        }
        console.log(`[${RETAILER}]   ${cards.length} cards · ${added} new · ${merged} merged into existing`);
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
    }

    const collected = [...byUrl.values()].map((e) => ({ ...e, rooms: [...e.rooms] }));
    console.log(`[${RETAILER}] ${collected.length} unique products after PLP walk`);

    await ctx.close();

    // Image downloads — Crawl-delay applies to page crawls; CDN asset
    // fetches are commonly excluded. Use a gentler 1s gap. Carpet
    // swatch images are small (~50-100KB) so even this is plenty.
    const IMAGE_GAP_MS = 1000;
    const products = [];
    for (let i = 0; i < Math.min(collected.length, TARGET_MAX); i++) {
      const c = collected[i];
      if (i > 0) await sleep(IMAGE_GAP_MS);
      const slug = slugFromUrl(c.productUrl);
      const heroSrc = canonicalImage(c.imgSrc);
      if (!heroSrc) {
        errors.push({ url: c.productUrl, error: 'no usable image' });
        continue;
      }
      let hero = null;
      try {
        const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
        hero = dl.localPath;
      } catch (err) {
        errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: c.productUrl });
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: c.name,
        category: c.category,
        // Carpets are quoted per m² and curtains are made-to-measure —
        // no flat retail price on the PLP. Leave null; the UI shows
        // "Get a quote" for null-priced items.
        price: null,
        currency: 'AUD',
        // Stash rooms in dimensions so ingest preserves them (the
        // products table has no dedicated room column; dimensions is
        // jsonb and already used by other scrapers for paint hex).
        // Picking-list query can filter via dimensions->'rooms' ? 'bedroom'.
        // Empty array for curtains (universally suitable — no room lock).
        dimensions: c.rooms.length > 0 ? { rooms: c.rooms } : null,
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: c.productUrl,
        description: c.imgAlt || null,
        market_segment: segmentFor(RETAILER),
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] downloaded ${i + 1}/${Math.min(collected.length, TARGET_MAX)}`);
    }

    await writeJson(path.join(outDir, 'products.json'), products);
    if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
    console.log(`[${RETAILER}] wrote ${products.length} products, ${errors.length} errors`);
    return { retailer: RETAILER, products, errors };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCarpetCourt()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('carpet court scrape failed', err);
      process.exit(1);
    });
}
