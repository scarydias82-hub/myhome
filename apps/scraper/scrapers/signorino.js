// Signorino — premium AU tile + natural stone importer. Custom CMS.
// Tile ranges live at /range/<name>/ with ~6 colour variants per
// page surfaced as <img> tags carrying alt text like "Allure - Alaska",
// "Bari Amazonite", "Anthology Dark". Each img.alt → variant name;
// each img.src → high-res hero. No retail prices (B2B / trade).
//
// Strategy:
//   1. Walk /range to harvest all /range/<name>/ URLs.
//   2. For each range, visit + extract the <img> elements whose src
//      sits on signorino.com.au and whose alt is non-trivial — those
//      are the colour variants. Each becomes a separate product SKU.
//   3. Download the hero image, persist with category=Tiles.
//
// Why tiles matter for the picking list: tiles have very specific
// colour profiles (calacatta marble = #F3F0E8, terracotta = #C4785A,
// black slate = #2A2825). The palette-match filter at ingest will
// tag each tile with the palettes it fits — so a "Tomato Red & Umber"
// bathroom render auto-features terracotta tiles, a "Misty Blue"
// bathroom gets aqua mosaics, etc.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.signorino.com.au';
const RETAILER = 'Signorino';
const RETAILER_SLUG = 'signorino';
const TARGET_RANGES = 40;        // ~240 tiles at 6 variants/range
const TARGET_MAX = 300;          // cap on individual tile SKUs

function slugFromRange(rangePath) {
  return rangePath.replace(/\/$/, '').split('/').filter(Boolean).pop();
}

function slugFromAlt(alt) {
  return String(alt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function harvestRangeUrls(page) {
  await page.goto(`${ORIGIN}/range`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);
  for (let y = 0; y < 8000; y += 1000) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => {
    return [...document.querySelectorAll('a[href*="/range/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && /\/range\/[a-z0-9-]+\/?$/i.test(h))
      .map((h) => {
        // Normalise to path-only.
        const url = new URL(h, window.location.origin);
        return url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
      })
      .filter((h, i, arr) => arr.indexOf(h) === i);
  });
}

async function extractRangeVariants(page, rangeUrl) {
  await page.goto(rangeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const rangeName = document.querySelector('h1')?.innerText?.trim() ?? '';
    const variants = [...document.querySelectorAll('img')]
      .filter((img) => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const alt = (img.getAttribute('alt') || '').trim();
        if (!src) return false;
        if (!alt) return false;
        if (alt.length < 3 || alt.length > 80) return false;
        // Drop logos, icons, wishlist chrome, social links.
        if (/logo|icon|chevron|arrow|wishlist|sprite|favicon/i.test(src)) return false;
        if (/logo|icon|wishlist|favicon/i.test(alt)) return false;
        return true;
      })
      .map((img) => ({
        alt: (img.getAttribute('alt') || '').trim(),
        src: img.getAttribute('src') || img.getAttribute('data-src') || '',
      }))
      // Dedup by alt — sometimes the same variant image appears twice
      // (thumbnail + hero).
      .filter((v, i, arr) => arr.findIndex((x) => x.alt === v.alt) === i)
      .slice(0, 10); // hard cap per range so a stray gallery doesn't explode
    return { rangeName, variants };
  });
}

export async function scrapeSignorino() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(`${ORIGIN}/range`))) {
    console.warn(`[${RETAILER}] robots disallows /range, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet')
        return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // 1. Harvest range URLs.
    const allRanges = await harvestRangeUrls(page);
    const ranges = allRanges.slice(0, TARGET_RANGES);
    console.log(`[${RETAILER}] ${allRanges.length} ranges found, walking first ${ranges.length}`);

    // 2. Walk each range, collect variant card data.
    const collected = []; // [{ rangePath, rangeName, alt, src }]
    for (let i = 0; i < ranges.length; i++) {
      const rangePath = ranges[i];
      const rangeUrl = `${ORIGIN}${rangePath}`;
      if (!(await isAllowed(rangeUrl))) continue;
      try {
        const { rangeName, variants } = await extractRangeVariants(page, rangeUrl);
        for (const v of variants) {
          collected.push({ rangePath, rangeName, alt: v.alt, src: v.src });
        }
        if ((i + 1) % 5 === 0) {
          console.log(`[${RETAILER}] ${i + 1}/${ranges.length} ranges walked, ${collected.length} variants so far`);
        }
        await delay(800);
      } catch (err) {
        errors.push({ url: rangeUrl, error: String(err?.message ?? err) });
      }
    }

    console.log(`[${RETAILER}] ${collected.length} total variants harvested`);

    await ctx.close();

    // 3. Download hero per variant. Dedup by alt+rangePath because
    // sometimes alt collides across ranges (e.g. "Outdoor Paver").
    const seenSku = new Set();
    const products = [];
    let droppedDuplicate = 0;
    for (let i = 0; i < Math.min(collected.length, TARGET_MAX); i++) {
      const c = collected[i];
      const rangeSlug = slugFromRange(c.rangePath);
      const variantSlug = slugFromAlt(c.alt);
      const sku = `${rangeSlug}-${variantSlug}`;
      if (seenSku.has(sku)) {
        droppedDuplicate++;
        continue;
      }
      seenSku.add(sku);

      let hero = null;
      try {
        const dl = await downloadImage({ url: c.src, retailerDir: outDir, slug: sku, index: 0 });
        hero = dl.localPath;
        await delay(500);
      } catch (err) {
        errors.push({ url: c.src, error: String(err?.message ?? err), productUrl: `${ORIGIN}${c.rangePath}` });
      }

      products.push({
        id: sku,
        retailer: RETAILER,
        name: c.alt,
        category: 'Tiles',
        // Trade pricing — no public retail price for tiles.
        price: null,
        currency: 'AUD',
        dimensions: { range: c.rangeName || rangeSlug },
        images: { hero, downloaded: hero != null, source: c.src, all: hero ? [hero] : [] },
        product_url: `${ORIGIN}${c.rangePath}`,
        description: `${c.rangeName || rangeSlug} range — ${c.alt}`,
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 30 === 0) console.log(`[${RETAILER}] downloaded ${i + 1}/${Math.min(collected.length, TARGET_MAX)}`);
    }

    await writeJson(path.join(outDir, 'products.json'), products);
    if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
    console.log(
      `[${RETAILER}] wrote ${products.length} tiles, ${errors.length} errors ` +
        `(${droppedDuplicate} cross-range duplicates)`,
    );
    return { retailer: RETAILER, products, errors };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeSignorino()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} tiles, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('signorino scrape failed', err);
      process.exit(1);
    });
}
