// Fantastic Furniture — SAP Commerce Cloud (Hybris) front-end behind
// Cloudflare. The storefront HTML is a 1.9KB JS shell that hydrates
// client-side; product cards never appear in the initial DOM.
//
// Strategy modelled on the Freedom scraper:
//   1. Warm up the Cloudflare cookie by visiting the homepage first.
//   2. For each category landing, scroll to force hydration AND
//      intercept api.fantasticfurniture.com.au JSON responses so we
//      collect product URLs from both the rendered DOM and the
//      SAP/OCC API the SPA fires during boot.
//   3. Visit each product detail page (also SPA) and read JSON-LD +
//      OpenGraph meta tags after `h1` mounts.
//
// Sitemap was the reconnaissance shortcut — the category list at
// api.fantasticfurniture.com.au/medias/Category-... carries every
// `/c/<slug>` path. The landings below were picked from that list.
//
// Scope: 9 canonical categories matching the §6.11 budget rollout —
// Sofas, Chairs, Stools, Rugs, Lamps, Wall Lights, Beds, Desks.
// (No Mirrors — not on the user's list and Fantastic's mirror catalogue
// is thin anyway.)
//
// Tier: budget. Sofas $400–$1,200 per the §6.11 anchor.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.fantasticfurniture.com.au';
const RETAILER = 'Fantastic Furniture';
const RETAILER_SLUG = 'fantastic';
const DEFAULT_PER_LANDING_MAX = 50;

// Multi-URL canonicals (Chairs, Lamps) split their cap so each canonical
// stays in the 30–50 range. Single-URL canonicals use the default.
const CATEGORY_LANDINGS = [
  { url: `${ORIGIN}/c/sofas-and-armchairs`, category: 'Sofas' },
  { url: `${ORIGIN}/c/dining-chairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/c/armchairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/c/bar-stools`, category: 'Stools' },
  { url: `${ORIGIN}/c/rugs`, category: 'Rugs' },
  { url: `${ORIGIN}/c/table-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/c/floor-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/c/wall-lights`, category: 'Wall Lights' },
  { url: `${ORIGIN}/c/beds`, category: 'Beds' },
  { url: `${ORIGIN}/c/desks`, category: 'Desks' },
];

// Product URL shape: /<slug>/p/<SKU>. The SKU is uppercase letters +
// digits, typically 10–20 chars (e.g. BGBOTTRECSELCHIOAT). The slug
// before /p/ is the product's display slug — we use it as the local
// id since it's stable and human-readable.
const PRODUCT_HREF_RE = /\/([a-z0-9-]+)\/p\/([A-Z0-9]+)$/;
const PRODUCT_SELECTOR = 'a[href*="/p/"]';

async function collectProductUrls(page, landingUrl) {
  const apiProductUrls = new Set();
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('api.fantasticfurniture.com.au')) return;
    try {
      const ct = response.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const json = await response.json();
      walkForFantasticProducts(json, apiProductUrls);
    } catch {
      /* not JSON or parse error — ignore */
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    page.off('response', onResponse);
    return [];
  }

  // The SPA renders product cards async; wait for the first card to
  // appear, then scroll to mount lazy ones. Network never goes idle
  // (persistent analytics + ads), so we don't waitForLoadState here.
  try {
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 20000 });
  } catch {
    /* DOM hydration may have failed; the API interceptor is the
       fallback. Don't abort. */
  }

  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
  }

  const domUrls = await page.evaluate((sel) => {
    const seen = new Set();
    for (const a of document.querySelectorAll(sel)) {
      const href = a.href;
      if (!href) continue;
      // Strip query string & hash so /widget-slug/p/SKU?xy=... dedupes.
      const clean = href.split('?')[0].split('#')[0];
      seen.add(clean);
    }
    return [...seen];
  }, PRODUCT_SELECTOR);

  page.off('response', onResponse);

  // Merge DOM + API, dedupe, validate shape.
  const merged = new Set();
  for (const u of [...domUrls, ...apiProductUrls]) {
    try {
      const parsed = new URL(u);
      if (parsed.host !== 'www.fantasticfurniture.com.au') continue;
      if (PRODUCT_HREF_RE.test(parsed.pathname)) {
        merged.add(`${parsed.origin}${parsed.pathname}`);
      }
    } catch {
      /* malformed URL — skip */
    }
  }
  return [...merged];
}

// Walk a JSON tree and collect any Fantastic product slug/SKU pairs.
// SAP/OCC product responses bury fields under varying keys
// (results, products, productListEntries, etc.) — pattern-matching
// by shape is more robust than guessing the schema. We look for:
//   - A `url` string ending in `/p/<SKU>` (already a path or full URL)
//   - A `code` field that looks like a Fantastic SKU paired with
//     a `name` + `url` sibling.
function walkForFantasticProducts(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) walkForFantasticProducts(v, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /\/[a-z0-9-]+\/p\/[A-Z0-9]+/.test(value) && /url|link|href/i.test(key)) {
      const abs = value.startsWith('http') ? value : `${ORIGIN}${value.startsWith('/') ? value : '/' + value}`;
      out.add(abs);
    } else if (typeof value === 'object') {
      walkForFantasticProducts(value, out);
    }
  }
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  // /<slug>/p/<SKU> — use the slug; SKU is captured as a fallback.
  const m = url.match(PRODUCT_HREF_RE);
  if (!m) return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
  return `${m[1]}-${m[2]}`.slice(0, 80);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('h1', { timeout: 12000 });
  } catch {
    /* allow extraction to proceed — we'll fall back to meta tags */
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) =>
      document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;

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
    const productLd = flat.find(
      (n) => n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product')),
    );
    const offer = productLd?.offers;
    const ldPrice = Array.isArray(offer) ? offer[0]?.price : offer?.price;
    const ldImage = Array.isArray(productLd?.image) ? productLd.image[0] : productLd?.image;

    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: ldImage ?? document.querySelector('img[src*="medias/"], .product-image img, [class*="ProductImage"] img')?.src ?? null,
      ldPrice: ldPrice ?? null,
      ldName: productLd?.name ?? null,
      ldDescription: productLd?.description ?? null,
      priceTexts: [...document.querySelectorAll('[class*="price"], [class*="Price"]')]
        .map((e) => e.innerText.trim())
        .filter(Boolean),
      bodyText: document.body.innerText.slice(0, 6000),
    };
  });
}

export async function scrapeFantastic() {
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
    // Block heavy assets we don't need (image binaries get fetched
    // later via the downloadImage util, after we've identified the
    // hero source).
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });

    // Cloudflare warm-up — visit the homepage so cf_clearance + co.
    // attach to the context before we hit category URLs. Without it,
    // some category pages return the JS challenge interstitial.
    try {
      const warm = await ctx.newPage();
      await warm.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await warm.waitForTimeout(2500);
      await warm.close();
    } catch (err) {
      console.warn(`[${RETAILER}] homepage warm-up failed: ${err.message}`);
    }

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
  scrapeFantastic()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('fantastic scrape failed', err);
      process.exit(1);
    });
}
