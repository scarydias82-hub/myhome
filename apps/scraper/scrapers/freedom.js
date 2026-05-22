// Freedom Furniture — Angular SPA. Category landing pages are SSR shell
// only; product cards are injected client-side after hydration. The
// previous version used a 1.2s scroll loop which finished before
// hydration completed, so we got zero product URLs.
//
// Fix: longer total wait (up to 25s per category page), wait
// explicitly for the product card class to appear, AND fall back to
// intercepting the `api-prod.freedom.com.au` JSON responses that the
// SPA fires during hydration. Whichever yields URLs first wins.
//
// Scope: mirrors + rugs + sofas (per product owner). Per-category cap
// keeps the total visit count finite.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.freedom.com.au';
const RETAILER = 'Freedom';
const RETAILER_SLUG = 'freedom';
const DEFAULT_PER_LANDING_MAX = 50;

// Multi-URL canonical categories (Chairs, Lamps) split their cap across
// landings so the total per canonical category stays in the 30–50
// range the catalogue targets. Single-URL categories use the default.
const CATEGORY_LANDINGS = [
  { url: `${ORIGIN}/sofas-and-armchairs/c/all-sofas`, category: 'Sofas' },
  { url: `${ORIGIN}/rugs/c/all-rugs`, category: 'Rugs' },
  { url: `${ORIGIN}/wall-art-mirrors-and-lighting/wall-decor-and-mirrors/c/mirrors`, category: 'Mirrors' },
  { url: `${ORIGIN}/living-and-dining/dining-furniture/c/dining-chairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/sofas-and-armchairs/all-sofas/c/all-armchairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/living-and-dining/dining-furniture/c/bar-stools`, category: 'Stools' },
  { url: `${ORIGIN}/wall-art-mirrors-and-lighting/lights/c/table-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/wall-art-mirrors-and-lighting/lights/c/floor-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/wall-art-mirrors-and-lighting/c/wall-lights`, category: 'Wall Lights' },
  { url: `${ORIGIN}/bedroom/c/beds`, category: 'Beds' },
  { url: `${ORIGIN}/storage/office/c/desks`, category: 'Desks' },
];

// Try several selectors — Freedom's Angular components don't expose a
// stable class hierarchy, so we accept any `a` whose href matches the
// product-id pattern, regardless of wrapper class.
const PRODUCT_SELECTOR = 'a[href*="/product/"]';

async function collectProductUrls(page, landingUrl) {
  // Network interceptor — captures the SPA's API responses while we
  // give the page time to hydrate. Often the product list comes back
  // before any DOM is populated, so this is a useful fallback even when
  // the DOM scrape works.
  const apiProductUrls = new Set();
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('api-prod.freedom.com.au')) return;
    try {
      const ct = response.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const json = await response.json();
      walkForFreedomProductIds(json, apiProductUrls);
    } catch {
      /* not JSON or error fetching — ignore */
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    page.off('response', onResponse);
    return [];
  }

  // Give the Angular bundle time to fetch + render product cards.
  // networkidle never fires on this site (persistent analytics), so we
  // wait explicitly for the selector AND swallow the timeout if it
  // never appears — we still have the API interceptor as fallback.
  try {
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 20000 });
  } catch {
    /* DOM hydration may have failed — rely on API interceptor */
  }

  // Scroll to ensure lazy-loaded cards mount.
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
  }

  const domUrls = await page.evaluate((sel) => {
    const seen = new Set();
    for (const a of document.querySelectorAll(sel)) {
      const href = a.href;
      if (!href) continue;
      const m = href.match(/\/product\/(\d+)/);
      if (!m) continue;
      seen.add(`https://www.freedom.com.au/product/${m[1]}`);
    }
    return [...seen];
  }, PRODUCT_SELECTOR);

  page.off('response', onResponse);

  // Merge DOM + API results, dedupe.
  const all = new Set([...domUrls, ...apiProductUrls]);
  return [...all];
}

// Walk a JSON tree and collect any Freedom product-id-shaped strings.
// The SPA's API responses bury product ids under varying keys
// (results.products, items, etc.) — pattern-matching the id shape is
// more robust than guessing the schema.
function walkForFreedomProductIds(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) walkForFreedomProductIds(v, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'number' && /^id$|productId|product_id/i.test(key) && value > 1_000_000) {
      out.add(`https://www.freedom.com.au/product/${value}`);
    } else if (typeof value === 'string' && /^\d{7,9}$/.test(value) && /id$|productId|product_id/i.test(key)) {
      out.add(`https://www.freedom.com.au/product/${value}`);
    } else if (typeof value === 'object') {
      walkForFreedomProductIds(value, out);
    }
  }
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Product pages are server-rendered with JSON-LD embedded — wait for
  // h1 to confirm hydration, then read.
  try {
    await page.waitForSelector('h1', { timeout: 12000 });
  } catch {
    /* fall through */
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    const ldNodes = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((n) => {
        try { return JSON.parse(n.innerText); } catch { return null; }
      })
      .filter(Boolean);
    const flat = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') { flat.push(n); Object.values(n).forEach(walk); }
    };
    ldNodes.forEach(walk);
    const productLd = flat.find((n) => n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product')));
    const offer = productLd?.offers;
    const ldPrice = Array.isArray(offer) ? offer[0]?.price : offer?.price;
    const ldImage = Array.isArray(productLd?.image) ? productLd.image[0] : productLd?.image;
    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: ldImage ?? document.querySelector('img[src*="medias/"], .product-image img')?.src ?? null,
      ldPrice: ldPrice ?? null,
      ldName: productLd?.name ?? null,
      ldDescription: productLd?.description ?? null,
      priceTexts: [...document.querySelectorAll('[class*="price"]')].map((e) => e.innerText.trim()).filter(Boolean),
      bodyText: document.body.innerText.slice(0, 6000),
    };
  });
}

export async function scrapeFreedom() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(`${ORIGIN}/`))) {
    console.warn(`[${RETAILER}] robots disallows origin, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets we don't need (we still get image URLs from
    // the DOM / API responses; we just don't fetch the binaries during
    // category browsing).
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    const all = [];
    for (const { url, category, max } of CATEGORY_LANDINGS) {
      console.log(`[${RETAILER}] ${category}: loading ${url}`);
      const urls = await collectProductUrls(page, url);
      console.log(`[${RETAILER}] ${category}: ${urls.length} product urls`);
      const slice = urls.slice(0, max ?? DEFAULT_PER_LANDING_MAX);
      for (const u of slice) all.push({ url: u, category });
      await delay();
    }

    const products = [];
    for (let i = 0; i < all.length; i++) {
      const { url, category } = all[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProduct(page, url);
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;
        const price = raw.ldPrice ? Number(raw.ldPrice) : parsePriceString(raw.priceTexts[0]);
        const dimensions = parseDimensions(raw.bodyText);
        const description = (raw.ldDescription ?? raw.ogDescription ?? '').slice(0, 600);

        let hero = null;
        if (heroSrc) {
          try {
            const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
            hero = dl.localPath;
          } catch (err) {
            errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: url });
          }
        }

        products.push({
          id: slug,
          retailer: RETAILER,
          name: raw.ldName ?? raw.h1 ?? raw.title ?? slug,
          category,
          price: Number.isFinite(price) ? price : null,
          currency: 'AUD',
          dimensions,
          images: { hero, downloaded: hero != null, source: heroSrc ?? null, all: hero ? [hero] : [] },
          product_url: url,
          description,
          market_segment: segmentFor(RETAILER),
          scraped_at: new Date().toISOString(),
        });
        if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${all.length}`);
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
      await delay();
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
  scrapeFreedom()
    .then(({ products, errors }) => console.log(`done — ${products.length} products, ${errors.length} errors`))
    .catch((err) => {
      console.error('freedom scrape failed', err);
      process.exit(1);
    });
}
