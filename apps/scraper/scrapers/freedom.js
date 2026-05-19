// Freedom Furniture — Angular SPA, sitemap of ~84k product URLs. JSON-LD
// embedded in product pages but only after Angular hydrates, so Playwright
// is required. Scope: mirrors + rugs + sofas (per product owner). The
// product-id-only URL pattern (/product/12345) makes pre-filtering
// impossible — we have to visit each product and inspect breadcrumbs to
// know what category it's in. We limit total visits to keep the scrape
// finite; downstream we cap per-category.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.freedom.com.au';
const RETAILER = 'Freedom';
const RETAILER_SLUG = 'freedom';
const PER_CATEGORY_MAX = 30; // 30 sofas + 30 rugs + 30 mirrors = 90 products

// Three category landing URLs we can visit to harvest product links.
const CATEGORY_LANDINGS = [
  { url: `${ORIGIN}/sofas-and-armchairs/c/all-sofas`, category: 'Sofas' },
  { url: `${ORIGIN}/rugs/c/all-rugs`, category: 'Rugs' },
  { url: `${ORIGIN}/wall-art-mirrors-and-lighting/wall-decor-and-mirrors/c/mirrors`, category: 'Mirrors' },
];

async function collectProductUrls(page, landingUrl) {
  try {
    await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    return [];
  }
  // Wait for product grid to hydrate.
  try {
    await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 });
  } catch {
    return [];
  }
  // Scroll to load more.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
  return page.evaluate(() => {
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/product/"]')) {
      const href = a.href;
      if (!href) continue;
      // Strip query/hash and stop after the numeric product id.
      const m = href.match(/\/product\/(\d+)/);
      if (!m) continue;
      seen.add(`https://www.freedom.com.au/product/${m[1]}`);
    }
    return [...seen];
  });
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

async function extractProduct(page, url, category) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('h1', { timeout: 12000 });
  } catch {
    /* fall through, may still have JSON-LD */
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    // JSON-LD product schema is the most reliable price source on this site.
    const ldNodes = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((n) => {
        try {
          return JSON.parse(n.innerText);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const flat = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') {
        flat.push(n);
        Object.values(n).forEach(walk);
      }
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
    const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 1600 } });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    const all = [];
    for (const { url, category } of CATEGORY_LANDINGS) {
      const urls = await collectProductUrls(page, url);
      console.log(`[${RETAILER}] ${category}: ${urls.length} urls`);
      const slice = urls.slice(0, PER_CATEGORY_MAX);
      for (const u of slice) all.push({ url: u, category });
      await delay();
    }

    const products = [];
    for (let i = 0; i < all.length; i++) {
      const { url, category } = all[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProduct(page, url, category);
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
