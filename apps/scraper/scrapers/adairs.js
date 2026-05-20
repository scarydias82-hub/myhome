// Adairs — Australian homewares retailer running on an Episerver/Optimizely
// CMS (not Shopify). Their `/products.json` 404s and the
// `products-sitemap.xml` is polluted with discontinued products that live
// under `z-archive/` paths, so we scrape from the live PLP instead.
//
// Strategy: walk paginated category listings via `?page=N`. Each PLP
// renders product cards fully server-side with everything we need —
// title, image, product URL, SKU (`data-uniqueid`), and price range —
// so no per-product page visit is required. Faster, gentler on the
// origin, and avoids the z-archive products.
//
// Scope (this scraper deliberately drops a lot):
//   IN  — quilt covers, doona covers, duvet covers (Adairs file all
//         three under the same `quilt-covers-coverlets` category — the
//         names are synonymous in AU usage)
//   OUT — sheets, valances, pillowcases, throws, mattress protectors,
//         bath, dining, kids, furniture, curtains, decor
//
// Palette filter runs downstream at ingest (apps/scraper/utils/
// paletteMatch.js).

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.adairs.com.au';
const RETAILER = 'Adairs';
const RETAILER_SLUG = 'adairs';
// Multi-category walk. Each entry: PLP path + the catalog `category`
// label rows land under at ingest time (must match the categoryForLabel
// outputs in lib/detection.ts so the picking-list query finds them).
//   - /bedroom/quilt-covers-coverlets/  → "Quilt Covers" (313 products)
//   - /homewares/cushions/              → "Cushions"     (316 products)
//   - /homewares/throws/                → "Throws"       (~150 products)
// Cushions and throws fill the "no catalog matches for cushion / throw"
// demand-signal slots from R12 eval — Florence-2 detects them on
// virtually every bedroom render but our catalog had zero.
const CATEGORY_PLPS = [
  { path: '/bedroom/quilt-covers-coverlets/', category: 'Quilt Covers', cap: 120 },
  { path: '/homewares/cushions/', category: 'Cushions', cap: 120 },
  { path: '/homewares/throws/', category: 'Throws', cap: 80 },
];
const MAX_PAGES_PER_PLP = 12;
const EXCLUDE_PATTERNS =
  /(sheet[-\s]?set|fitted[-\s]?sheet|flat[-\s]?sheet|valance|mattress[-\s]?protector|pillow[-\s]?case[-\s]?only|bath|towel|robe|candle)/i;

function slugFromHref(href) {
  // Adairs product URLs look like
  // /bedroom/quilt-covers-coverlets/adairs/linen-cotton-burgundy-elijah-check-quilt-cover-set--separates/
  // Use the last non-empty segment as a unique-enough slug.
  return String(href)
    .replace(/\/$/, '')
    .split('/')
    .pop()
    .slice(0, 90);
}

// Adairs PLP price text comes as "$49.99 - $229.99" (range across
// sizes) or "$199.99" (single price). We take the LOW end — that's the
// entry-point price the user sees on the PLP. Strip the Linen Lovers
// member price (a separate line).
function parsePriceLow(priceTexts) {
  if (!Array.isArray(priceTexts) || priceTexts.length === 0) return null;
  const headline = priceTexts.find((t) => !/linen lovers/i.test(t)) ?? priceTexts[0];
  const matches = String(headline).match(/\$(\d+(?:\.\d{2})?)/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map((m) => Number(m.replace('$', ''))).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : null;
}

// Adairs uses cdn-cgi/image url rewriting to serve responsive sizes;
// strip that prefix so we get the original asset on globalassets/. The
// CDN URL is fine for browsers but worse for sharp's centre-crop
// dominant-colour extraction (we want the full-size original).
function canonicalImage(src) {
  if (!src) return null;
  if (src.startsWith('/cdn-cgi/image/')) {
    // e.g. /cdn-cgi/image/fit=scale-down,quality=85,format=auto,width=555/globalassets/...
    const m = src.match(/\/cdn-cgi\/image\/[^/]+(\/globalassets\/.+)/);
    if (m) return `${ORIGIN}${m[1]}`;
  }
  if (src.startsWith('/globalassets/')) return `${ORIGIN}${src}`;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('http')) return src;
  return `${ORIGIN}${src}`;
}

async function extractCardsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Adairs lazy-loads card images via `loading="lazy"` but the markup
  // is already complete — no scroll needed. Brief settle then read.
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ProductCard')];
    return cards.map((card) => {
      const inner = card.querySelector('[data-uniqueid]');
      const uniqueid = inner?.getAttribute('data-uniqueid') ?? null;
      const linkEl = card.querySelector('a.ProductCard-item-title-link, a[href]');
      const imgEl = card.querySelector('img');
      const priceEls = [...card.querySelectorAll('[class*=price], [class*=Price]')];
      // Filter out the cart/badge SVG label nodes which sometimes pick
      // up [class*=price] noise — keep only ones with a $ in them.
      const priceTexts = priceEls
        .map((p) => p.innerText?.trim())
        .filter((t) => t && /\$/.test(t));
      return {
        uniqueid,
        href: linkEl?.getAttribute('href') ?? null,
        title: imgEl?.alt ?? null,
        imgSrc: imgEl?.getAttribute('src') ?? null,
        priceTexts,
      };
    });
  });
}

export async function scrapeAdairs() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  // robots.txt gate uses the first PLP as a representative — every
  // PLP we walk is under adairs.com.au so a single check covers them.
  const firstUrl = `${ORIGIN}${CATEGORY_PLPS[0].path}`;
  if (!(await isAllowed(firstUrl))) {
    console.warn(`[${RETAILER}] robots.txt disallows ${firstUrl}, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets — we don't need fonts/images/media on the PLP
    // walks (we'll fetch the canonical product image later for each
    // product we keep).
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // Walk each (PLP, category) tuple in CATEGORY_PLPS. Dedup by
    // data-uniqueid in case page boundaries overlap, and by href in
    // case Adairs lists the same product under multiple sub-categories.
    // Each card carries its source category so the per-product row
    // gets tagged correctly at scrape time.
    const seenUniqueIds = new Set();
    const seenHrefs = new Set();
    const cards = [];
    for (const plp of CATEGORY_PLPS) {
      const plpUrl = `${ORIGIN}${plp.path}`;
      if (!(await isAllowed(plpUrl))) {
        console.warn(`[${RETAILER}] robots disallows ${plpUrl}, skipping`);
        continue;
      }
      console.log(`[${RETAILER}] === ${plp.category} (${plp.path}) ===`);
      let plpCards = 0;
      for (let p = 1; p <= MAX_PAGES_PER_PLP && plpCards < plp.cap * 2; p++) {
        const url = `${ORIGIN}${plp.path}?page=${p}`;
        console.log(`[${RETAILER}] PLP page ${p}: ${url}`);
        try {
          const pageCards = await extractCardsFromPage(page, url);
          if (pageCards.length === 0) {
            console.log(`[${RETAILER}] page ${p} returned 0 cards — stopping`);
            break;
          }
          for (const c of pageCards) {
            if (!c.uniqueid || !c.href) continue;
            if (seenUniqueIds.has(c.uniqueid) || seenHrefs.has(c.href)) continue;
            if (c.title && EXCLUDE_PATTERNS.test(c.title)) continue;
            if (c.href && EXCLUDE_PATTERNS.test(c.href)) continue;
            seenUniqueIds.add(c.uniqueid);
            seenHrefs.add(c.href);
            cards.push({ ...c, category: plp.category, sourceCap: plp.cap });
            plpCards++;
          }
          await delay();
        } catch (err) {
          errors.push({ url, error: String(err?.message ?? err) });
        }
      }
      console.log(`[${RETAILER}] ${plp.category}: ${plpCards} new`);
    }

    console.log(`[${RETAILER}] ${cards.length} unique products across all PLPs`);

    // PLP walk done. Image downloads use downloadImage (node fetch)
    // and don't need the Playwright context, so close it now.
    await ctx.close();

    // Enforce per-category caps: count per category, take the first
    // cap items of each. Without this, we'd download all 316 cushion
    // images even though we only want 120.
    const perCatCount = new Map();
    const products = [];
    for (const c of cards) {
      const used = perCatCount.get(c.category) ?? 0;
      if (used >= c.sourceCap) continue;
      perCatCount.set(c.category, used + 1);

      const slug = slugFromHref(c.href);
      const productUrl = `${ORIGIN}${c.href}`;
      const heroSrc = canonicalImage(c.imgSrc);
      const price = parsePriceLow(c.priceTexts);

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
        id: c.uniqueid || slug,
        retailer: RETAILER,
        name: c.title || slug,
        category: c.category,
        price,
        currency: 'AUD',
        dimensions: parseDimensions(c.title ?? ''),
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: productUrl,
        description: null, // PLP doesn't carry description; could enrich via per-page visit later
        scraped_at: new Date().toISOString(),
      });
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
  scrapeAdairs()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('adairs scrape failed', err);
      process.exit(1);
    });
}
