// ABI Interiors — premium AU bathroom + kitchen hardware. Tapware,
// shower heads, towel rails, accessories. WordPress + WooCommerce
// stack — product-category PLPs paginate via /page/N/.
//
// This is myMaison's first tapware/bathroom-hardware scraper. Picking-
// list slots that previously had "no catalog matches for tap / shower /
// towel rail" on bathroom renders should populate after this lands.
//
// Categories we land into the catalog (mapped to Florence-2-friendly
// labels so the picking list filter finds them):
//   Tapware, Bathroom Accessories, Shower
//
// Each PLP entry maps a URL to a catalog category + a soft cap.
// Per-category caps prevent any one scrape over-indexing the catalog
// on one slot (we don't want 300 mixers and 12 towel rails).

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.abiinteriors.com.au';
const RETAILER = 'ABI Interiors';
const RETAILER_SLUG = 'abi-interiors';

// PLP walk targets. Each tuple = (URL path, catalog category, soft cap).
// Categories match the picking-list filter map in lib/matching.ts so
// detection labels (tap, faucet, shower-head, towel-rail) find them.
const CATEGORY_PLPS = [
  { path: '/product-category/tapware/bathroom-tapware/basin-taps-and-mixers/', category: 'Tapware', cap: 80 },
  { path: '/product-category/tapware/bathroom-tapware/wall-mixers/',            category: 'Tapware', cap: 40 },
  { path: '/product-category/shower/shower-heads/',                              category: 'Shower', cap: 50 },
  { path: '/product-category/shower/shower-rails/',                              category: 'Shower', cap: 30 },
  { path: '/product-category/accessories/bathroom-accessories/towel-rails/',     category: 'Bathroom Accessories', cap: 40 },
  { path: '/product-category/accessories/bathroom-accessories/towel-hooks/',     category: 'Bathroom Accessories', cap: 30 },
  { path: '/product-category/accessories/bathroom-accessories/toilet-roll-holders/', category: 'Bathroom Accessories', cap: 20 },
];

const MAX_PAGES_PER_PLP = 8;
// Reject sub-components and bulk swatches that aren't standalone products.
const EXCLUDE_PATTERNS =
  /(spare|replacement|cartridge|aerator|installation\skit|backplate|wall\sbracket)/i;

function slugFromHref(href) {
  return String(href)
    .replace(/\/$/, '')
    .split('/')
    .pop()
    .slice(0, 90);
}

// WooCommerce price markup is a <span class="woocommerce-Price-amount">.
// On variable products it shows a range ("$249 – $329") — we take the
// LOW end as the entry-point shopping price.
function parsePriceLow(priceTexts) {
  if (!Array.isArray(priceTexts) || priceTexts.length === 0) return null;
  const headline = priceTexts.find((t) => /\$/.test(t)) ?? priceTexts[0];
  const matches = String(headline).match(/\$(\d+(?:\.\d{2})?)/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map((m) => Number(m.replace('$', ''))).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : null;
}

// Strip ABI's image CDN sizing query (e.g. ?w=400&h=400&fit=crop) so we
// download the original asset. The original is fine for sharp's
// centre-crop dominant-colour extraction at ingest.
function canonicalImage(src) {
  if (!src) return null;
  try {
    const u = new URL(src, ORIGIN);
    u.search = '';
    return u.toString();
  } catch {
    return src.startsWith('http') ? src : `${ORIGIN}${src}`;
  }
}

async function extractCardsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // WooCommerce PLPs render server-side; brief settle then read.
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    // WooCommerce convention: li.product, but custom themes vary.
    // Try multiple selectors to be resilient against theme tweaks.
    const cards = [
      ...document.querySelectorAll('li.product, .product-card, [class*="product-item"], article.product'),
    ];
    return cards
      .map((card) => {
        const linkEl = card.querySelector('a[href*="/product/"], a.woocommerce-LoopProduct-link, a[href]');
        const href = linkEl?.getAttribute('href') ?? null;
        const titleEl =
          card.querySelector('.woocommerce-loop-product__title, h2, h3, [class*="title"]') ?? null;
        const title = titleEl?.innerText?.trim() ?? null;
        const imgEl = card.querySelector('img');
        const imgSrc =
          imgEl?.getAttribute('data-src') ??
          imgEl?.getAttribute('src') ??
          imgEl?.getAttribute('srcset')?.split(',')[0]?.trim()?.split(' ')[0] ??
          null;
        const priceEls = [
          ...card.querySelectorAll('.price, .woocommerce-Price-amount, [class*="price"]'),
        ];
        const priceTexts = priceEls.map((p) => p.innerText?.trim()).filter((t) => t && /\$/.test(t));
        return { href, title, imgSrc, priceTexts };
      })
      .filter((c) => c.href && c.title);
  });
}

export async function scrapeAbiInteriors() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

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
    // Block heavy assets — we only need the HTML for card extraction.
    await ctx.route('**/*', async (route) => {
      const t = route.request().resourceType();
      try {
        if (t === 'image' || t === 'media' || t === 'font') await route.abort();
        else await route.continue();
      } catch {
        /* page tear-down race — ignore */
      }
    });
    const page = await ctx.newPage();

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
        // WooCommerce pagination: /page/N/ appended to the category URL.
        const url = p === 1 ? plpUrl : `${plpUrl}page/${p}/`;
        console.log(`[${RETAILER}] PLP page ${p}: ${url}`);
        try {
          const pageCards = await extractCardsFromPage(page, url);
          if (pageCards.length === 0) {
            console.log(`[${RETAILER}] page ${p} returned 0 cards — stopping`);
            break;
          }
          for (const c of pageCards) {
            if (!c.href || seenHrefs.has(c.href)) continue;
            if (c.title && EXCLUDE_PATTERNS.test(c.title)) continue;
            if (c.href && EXCLUDE_PATTERNS.test(c.href)) continue;
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

    await ctx.close();

    // Per-category caps + image download.
    const perCatCount = new Map();
    const products = [];
    for (const c of cards) {
      const used = perCatCount.get(c.category) ?? 0;
      if (used >= c.sourceCap) continue;
      perCatCount.set(c.category, used + 1);

      const slug = slugFromHref(c.href);
      const heroSrc = canonicalImage(c.imgSrc);
      const price = parsePriceLow(c.priceTexts);

      if (!heroSrc) {
        errors.push({ url: c.href, error: 'no usable image' });
        continue;
      }

      let hero = null;
      try {
        const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
        hero = dl.localPath;
        await delay(500);
      } catch (err) {
        errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: c.href });
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: c.title ?? slug,
        category: c.category,
        price,
        currency: 'AUD',
        dimensions: parseDimensions(c.title ?? ''),
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: c.href,
        description: null,
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
  scrapeAbiInteriors()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('abi interiors scrape failed', err);
      process.exit(1);
    });
}
