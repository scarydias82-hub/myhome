// GlobeWest — Magento, trade-only catalogue. Most product pages are gated
// behind "Become a trade customer", but their /in-stock listing is public
// and the individual in-stock product pages are public too. We scrape only
// those.
//
// Magento SSR is minimal — the page hydrates client-side, so we need
// Playwright to wait for JS and read the rendered DOM. To keep the scrape
// fast we run a single browser/context/page and block image/font network
// traffic (we still get image URLs from the DOM; we just don't fetch them
// during the page load).

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.globewest.com.au';
const RETAILER = 'GlobeWest';
const RETAILER_SLUG = 'globewest';
const TARGET_MAX = 160;
// /indoor surfaces actual furniture cards; /in-stock is mostly decor only.
// Plus narrow category walks for picking-list demand gaps surfaced by
// the R12 eval ("no catalog matches for ottoman / console / bedside
// table"). The broad /indoor URL has these categories but underweights
// them — walking each PLP directly ensures coverage.
const LISTING_URLS = [
  `${ORIGIN}/indoor`,
  `${ORIGIN}/outdoor`,
  `${ORIGIN}/in-stock`,
  `${ORIGIN}/indoor/furniture/sofas/ottomans`,
  `${ORIGIN}/indoor/furniture/side-tables`,
  `${ORIGIN}/indoor/furniture/storage-shelving`,
];

// SKU prefix → category. GlobeWest's SKUs are like ch-ril-arm-... (chair),
// cto-pippa-tri-x (coffee table), sof-... (sofa), bed-... (bed), etc.
const CATEGORY_BY_PREFIX = {
  sof: 'Sofas',
  ch: 'Chairs',
  cha: 'Chairs',
  ott: 'Ottomans',
  bed: 'Beds',
  hdb: 'Beds',
  cto: 'Coffee Tables',
  sto: 'Side Tables',
  cst: 'Side Tables',
  dto: 'Dining Tables',
  tbl: 'Tables',
  des: 'Desks',
  con: 'Consoles',
  sb: 'Sideboards',
  ent: 'Entertainment Units',
  bky: 'Bookcases',
  rug: 'Rugs',
  lit: 'Lighting',
  lgt: 'Lighting',
  lam: 'Lighting',
  mir: 'Mirrors',
  art: 'Art',
};
// Hero furniture prefixes — we cap at 100 of these, but keep accents as well.
const HERO_PREFIXES = new Set(['sof', 'ch', 'cha', 'ott', 'bed', 'cto', 'sto', 'cst', 'dto', 'tbl', 'des', 'con', 'sb', 'ent', 'bky']);
const EXCLUDE_PATTERNS = /(swatch|sample|spare|replacement|leg-cap|leg-extension|cushion-?cover|throw|coaster|napkin|placemat)/i;

// Pull the SKU prefix from the URL. GlobeWest puts the prefix as one of the
// trailing hyphen-separated tokens, e.g. .../riley-dining-armchair-...-ch-ril-arm-...
// We sniff trailing tokens for a known prefix.
function prefixFromUrl(url) {
  const tail = url.split('/').pop() ?? '';
  const tokens = tail.split('-');
  // Inspect the last ~6 tokens (skip very long URLs gracefully).
  for (let i = Math.max(0, tokens.length - 7); i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase();
    if (CATEGORY_BY_PREFIX[tok]) return tok;
  }
  return null;
}

function categoryFromUrl(url) {
  const pfx = prefixFromUrl(url);
  return pfx ? CATEGORY_BY_PREFIX[pfx] : 'Furniture';
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

async function collectListingUrls(page, listingUrl) {
  // 'networkidle' never fires on this site (persistent analytics polling), so
  // we use 'domcontentloaded' and then wait for product cards explicitly.
  try {
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    return [];
  }
  try {
    await page.waitForSelector('[class*="product-item"], [class*="product-card"]', { timeout: 15000 });
  } catch {
    return [];
  }
  // Scroll repeatedly to load all cards (Magento listings often lazy-load).
  let lastCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const count = await page.evaluate(
      () => document.querySelectorAll('[class*="product-item"], [class*="product-card"]').length,
    );
    if (count === lastCount && count > 0) break;
    lastCount = count;
  }
  return page.evaluate(() => {
    const seen = new Set();
    for (const a of document.querySelectorAll('a')) {
      const href = a.href;
      if (!href) continue;
      if (!/globewest\.com\.au\/[a-z0-9-]+$/i.test(href)) continue;
      if (
        /\/(indoor|outdoor|homeware|in-stock|customisation|project|inspiration|blog|help-centre|contact-us|login|cart|account|online-booking|living|dining|bedroom|sofas|chairs|tables|beds|outdoor-furniture|subscribe-to-our-database|how-to-buy|locator|contact)$/i.test(
          href,
        )
      )
        continue;
      seen.add(href);
    }
    return [...seen];
  });
}

function isFurniture(url) {
  if (EXCLUDE_PATTERNS.test(url)) return false;
  const pfx = prefixFromUrl(url);
  return pfx != null && HERO_PREFIXES.has(pfx);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Wait for the H1 to appear — that tells us hydration has happened.
  try {
    await page.waitForSelector('h1', { timeout: 12000 });
  } catch {
    /* gated page or other failure — handled below */
  }
  // Give price/spec panels a moment to render after H1 lands.
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    // Pull every price candidate (Magento renders multiple instances).
    const priceTexts = [...document.querySelectorAll('[class*="price"], [data-price-amount]')]
      .map((e) => e.innerText.trim())
      .filter(Boolean);
    // Spec / dimensions text — pull a generous slab so the regex parser can hit.
    const specEls = document.querySelectorAll(
      '.additional-attributes-wrapper, .product-detailed-info, .product-info-tabs, .product.attribute.description, [class*="specification"], [class*="dimension"], [data-content-type="row"]',
    );
    const specText = [...specEls].map((e) => e.innerText).join('\n').slice(0, 6000);
    const bodyTail = document.body.innerText.slice(0, 12000);
    const gated =
      document.body.innerText.includes('Page not available') ||
      document.body.innerText.includes('trade-only');
    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: document.querySelector('.fotorama__img, .product.media img, img[itemprop="image"]')?.src ?? null,
      priceTexts,
      specText: specText + '\n' + bodyTail,
      gated,
    };
  });
}

export async function scrapeGlobeWest() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
    });
    // Block heavy assets we don't need for HTML scraping. Wrapping
    // route.abort/continue in try/catch swallows TargetClosedError
    // when navigation tears down with requests still in flight —
    // happens more often now that we walk 6 listing URLs (each
    // triggers analytics + lazyload pings that may outlive the page).
    await ctx.route('**/*', async (route) => {
      const t = route.request().resourceType();
      try {
        if (t === 'image' || t === 'media' || t === 'font') await route.abort();
        else await route.continue();
      } catch {
        /* page/context already closed — ignore */
      }
    });
    const page = await ctx.newPage();

    const harvested = new Set();
    for (const listing of LISTING_URLS) {
      if (!(await isAllowed(listing))) {
        console.warn(`[${RETAILER}] robots disallows ${listing}, skipping listing`);
        continue;
      }
      const urls = await collectListingUrls(page, listing);
      console.log(`[${RETAILER}] ${listing} → ${urls.length} urls`);
      for (const u of urls) harvested.add(u);
      await delay();
    }
    const furniture = [...harvested].filter(isFurniture);
    console.log(`[${RETAILER}] ${harvested.size} total, ${furniture.length} furniture urls`);
    const targetUrls = furniture.slice(0, TARGET_MAX);

    const products = [];
    for (let i = 0; i < targetUrls.length; i++) {
      const url = targetUrls[i];
      try {
        if (!(await isAllowed(url))) {
          console.warn(`[${RETAILER}] skip (robots): ${url}`);
          continue;
        }
        const raw = await extractProduct(page, url);
        if (raw.gated) {
          errors.push({ url, error: 'trade-gated' });
          continue;
        }
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;
        const price = parsePriceString(raw.priceTexts[0]);
        const dimensions = parseDimensions(raw.specText);
        const description = raw.ogDescription?.slice(0, 600) ?? null;

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
          name: raw.h1 ?? raw.title?.replace(/^Buy\s+|\s+online.*$/g, '') ?? slug,
          category: categoryFromUrl(url),
          price,
          currency: 'AUD',
          dimensions,
          images: {
            hero,
            downloaded: hero != null,
            source: heroSrc ?? null,
            all: hero ? [hero] : [],
          },
          product_url: url,
          description,
          scraped_at: new Date().toISOString(),
        });
        if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${targetUrls.length} scraped`);
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
  scrapeGlobeWest()
    .then(({ products, errors }) => {
      console.log(`done — ${products.length} products, ${errors.length} errors`);
    })
    .catch((err) => {
      console.error('globewest scrape failed', err);
      process.exit(1);
    });
}
