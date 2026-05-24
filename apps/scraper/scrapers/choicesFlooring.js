// Choices Flooring — major AU flooring + window-furnishings retailer
// running a custom Shopify storefront. Walk 4 category PLPs: timber,
// laminate, carpet, and rugs. (Hybrid + vinyl categories exist but
// live under different URL paths — TBD; revisit if eval shows a
// gap.) Each PLP renders Bootstrap `.product-card` elements server-
// side with everything we need: product URL, name, colour variant,
// CDN image. No real price on the listing — Choices uses qualitative
// `$$$` tier indicators, so we leave price null and let the UI
// surface a "Get a quote" CTA.
//
// Pricing model is per-m² for hard flooring and per-rug for rugs;
// flat retail prices aren't published per SKU.
//
// Palette filter runs downstream at ingest.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.choicesflooring.com.au';
const RETAILER = 'Choices Flooring';
const RETAILER_SLUG = 'choices-flooring';
const TARGET_MAX = 150;

const PLPS = [
  { path: '/timber-flooring/', category: 'Flooring', subtype: 'timber' },
  { path: '/laminate-flooring/', category: 'Flooring', subtype: 'laminate' },
  { path: '/carpet/', category: 'Carpet', subtype: null },
  { path: '/rugs/', category: 'Rugs', subtype: null },
];

const EXCLUDE_PATTERNS =
  /(underlay|accessory|installation|sample[-\s]?pack|fitting[-\s]?kit|care[-\s]?kit)/i;

function slugFromHref(href) {
  // URLs look like /product/<slug>
  return String(href)
    .replace(/^\//, '')
    .split('/')
    .pop()
    .slice(0, 90);
}

// Cloudinary URLs use a transformation prefix
// (/w_310,h_310,c_pad,b_white,f_webp). Strip those segments to get
// the original asset — better for sharp's dominant-colour extraction
// at ingest, and the original is the high-res print swatch.
function canonicalImage(src) {
  if (!src) return null;
  if (src.includes('res.cloudinary.com')) {
    return src.replace(/\/upload\/[^/]*\//, '/upload/');
  }
  return src;
}

async function extractCardsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Settle for lazy-load to populate, then collect.
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.product-card')];
    return cards.map((card) => {
      const linkEl = card.querySelector('a[href^="/product/"]');
      const productHref = linkEl?.getAttribute('href') ?? null;
      const imgEl = card.querySelector('img');
      const imgSrc = imgEl?.getAttribute('src') ?? null;
      const imgAlt = imgEl?.getAttribute('alt') ?? null;
      // Product name lives in .product-card-place; the colour variant
      // sub-name lives in .product-card-shop. Combine for the SKU name.
      const placeEl = card.querySelector('.product-card-place');
      const shopEl = card.querySelector('.product-card-shop');
      const placeName = placeEl?.innerText?.trim() ?? null;
      const variantName = shopEl?.innerText?.trim() ?? null;
      return { productHref, imgSrc, imgAlt, placeName, variantName };
    });
  });
}

function combineName(c) {
  // Card name: "Woodura 3.0 XL Contrast Collection — Dalshult Granite"
  // when both parts exist. Fall back to whichever is present.
  if (c.placeName && c.variantName) return `${c.placeName} — ${c.variantName}`;
  return c.placeName || c.variantName || c.imgAlt || 'Choices Flooring product';
}

export async function scrapeChoicesFlooring() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(`${ORIGIN}/timber-flooring/`))) {
    console.warn(`[${RETAILER}] robots disallows /timber-flooring/, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets — PLPs render fully server-side.
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet')
        return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // Walk PLPs.  Dedupe by product href — variants under /product/<slug>
    // can appear under multiple categories.
    const seen = new Set();
    const collected = [];
    for (const plp of PLPS) {
      const url = `${ORIGIN}${plp.path}`;
      if (!(await isAllowed(url))) {
        console.warn(`[${RETAILER}] robots disallows ${url}, skipping`);
        continue;
      }
      console.log(`[${RETAILER}] PLP: ${plp.path} (${plp.category})`);
      try {
        const cards = await extractCardsFromPage(page, url);
        let added = 0;
        let skipped = 0;
        for (const c of cards) {
          if (!c.productHref) continue;
          const name = combineName(c);
          if (!name) continue;
          if (EXCLUDE_PATTERNS.test(name) || EXCLUDE_PATTERNS.test(c.productHref)) continue;
          // Dedupe key is href + variant — Dalshult Granite and Dalshult
          // Oak are technically separate variants of the same Woodura
          // range, so we key on the combined name to keep both.
          const key = `${c.productHref}::${c.variantName ?? ''}`;
          if (seen.has(key)) {
            skipped++;
            continue;
          }
          seen.add(key);
          collected.push({ ...c, category: plp.category, name });
          added++;
        }
        console.log(`[${RETAILER}]   ${cards.length} cards · ${added} new · ${skipped} duplicates`);
        await delay();
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
    }

    console.log(`[${RETAILER}] ${collected.length} unique products after PLP walk`);

    await ctx.close();

    // Image downloads via the standard helper.
    const products = [];
    for (let i = 0; i < Math.min(collected.length, TARGET_MAX); i++) {
      const c = collected[i];
      const slug = slugFromHref(c.productHref);
      const productUrl = `${ORIGIN}${c.productHref}`;
      const heroSrc = canonicalImage(c.imgSrc);
      if (!heroSrc) {
        errors.push({ url: productUrl, error: 'no usable image' });
        continue;
      }
      let hero = null;
      try {
        const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
        hero = dl.localPath;
        await delay(600);
      } catch (err) {
        errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl });
      }
      products.push({
        id: `${slug}-${(c.variantName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` || slug,
        retailer: RETAILER,
        name: c.name,
        category: c.category,
        // Per-m² / made-to-measure pricing; no flat SKU price.
        price: null,
        currency: 'AUD',
        dimensions: null,
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: productUrl,
        description: c.imgAlt || null,
        market_segment: segmentFor(RETAILER),
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 20 === 0) console.log(`[${RETAILER}] downloaded ${i + 1}/${Math.min(collected.length, TARGET_MAX)}`);
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
  scrapeChoicesFlooring()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('choices flooring scrape failed', err);
      process.exit(1);
    });
}
