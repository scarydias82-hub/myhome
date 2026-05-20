// Tile Cloud — direct-to-consumer AU tile retailer. Headless Shopify
// backed by Next.js, so the PLPs server-render with full product cards
// (no client-side hydration needed). Bathroom-focused walk per the
// user's brief — bathroom floor, wall, and splashback tiles.
//
// Tile Cloud sells direct (DTC) versus Signorino which is trade-only,
// so this scraper closes the realistic-price gap for picking-list
// cost estimates on bathroom renders. Per-square-metre pricing
// surfaces on the card ("$71.13/m2"); we capture it.
//
// Why bathroom-first: the user's tag-driven brief flow (BRIEF #91-93)
// will increasingly land on bathroom recommendations, and we currently
// have no bathroom-grade tile catalog. Signorino's premium ranges
// cover natural stone; Tile Cloud covers porcelain + ceramic at
// accessible price points.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://tilecloud.com.au';
const RETAILER = 'Tile Cloud';
const RETAILER_SLUG = 'tile-cloud';

// Shopify collection walk. Tile Cloud's collection URLs follow
// /collections/<slug>?page=N. We target bathroom + kitchen-splashback
// surfaces since those are the rooms where tile renders most matter.
const CATEGORY_PLPS = [
  { path: '/collections/bathroom-floor-tiles', category: 'Tiles', cap: 80 },
  { path: '/collections/bathroom-wall-tiles',  category: 'Tiles', cap: 80 },
  { path: '/collections/splashback-tiles',     category: 'Tiles', cap: 40 },
  // Mosaics — high-character bathroom feature surfaces, smaller volume.
  { path: '/collections/mosaic-tiles',         category: 'Tiles', cap: 30 },
];

const MAX_PAGES_PER_PLP = 10;
const EXCLUDE_PATTERNS =
  /(sample|adhesive|grout|sealer|trim|edge\sprofile|spacer|installation\skit)/i;

function slugFromHref(href) {
  return String(href)
    .replace(/\/$/, '')
    .split('/')
    .pop()
    .slice(0, 90);
}

// Shopify product pricing usually renders as a plain "$XX.XX" or
// "$XX.XX/m2". Tile Cloud quotes per square metre — keep that suffix
// in the parsed value's note so the picking-list display can show
// "from $71/m²" rather than implying total cost.
function parsePricePerSqm(priceTexts) {
  if (!Array.isArray(priceTexts) || priceTexts.length === 0) return { price: null, perSqm: false };
  const headline = priceTexts.find((t) => /\$/.test(t)) ?? priceTexts[0];
  const matches = String(headline).match(/\$(\d+(?:\.\d{2})?)/g);
  if (!matches || matches.length === 0) return { price: null, perSqm: false };
  const nums = matches.map((m) => Number(m.replace('$', ''))).filter((n) => Number.isFinite(n) && n > 0);
  const price = nums.length ? Math.min(...nums) : null;
  const perSqm = /\/m2|\/m²|per\sm/i.test(headline);
  return { price, perSqm };
}

// Shopify headless setups expose product images via /_next/image?url=
// proxy. We strip that wrapper to get the underlying Shopify CDN URL,
// which produces a cleaner asset for sharp's dominant-colour pass.
function canonicalImage(src) {
  if (!src) return null;
  try {
    const u = new URL(src, ORIGIN);
    // Next.js image proxy: ?url=<encoded-real-url>
    if (u.pathname === '/_next/image') {
      const proxied = u.searchParams.get('url');
      if (proxied) return decodeURIComponent(proxied);
    }
    return u.toString();
  } catch {
    return src.startsWith('http') ? src : `${ORIGIN}${src}`;
  }
}

async function extractCardsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Headless Shopify pages hydrate client-side; wait for product cards
  // to appear before reading.
  try {
    await page.waitForSelector('a[href*="/products/"]', { timeout: 12000 });
  } catch {
    return [];
  }
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    // Anchor every product card on the product link itself, then walk
    // up to the nearest card wrapper.
    const links = [...document.querySelectorAll('a[href*="/products/"]')];
    const seen = new Set();
    const out = [];
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;
      // Walk up to find the card wrapper that contains an image + price.
      let card = link;
      for (let depth = 0; depth < 6 && card; depth++) {
        const hasImg = !!card.querySelector('img');
        const hasPrice = /\$/.test(card.innerText ?? '');
        if (hasImg && hasPrice) break;
        card = card.parentElement;
      }
      if (!card) continue;
      const imgEl = card.querySelector('img');
      const imgSrc =
        imgEl?.getAttribute('src') ??
        imgEl?.getAttribute('data-src') ??
        imgEl?.getAttribute('srcset')?.split(',')[0]?.trim()?.split(' ')[0] ??
        null;
      // Title — usually a heading inside the card.
      const titleEl =
        card.querySelector('h2, h3, [class*="title"], [class*="name"]') ?? link;
      const title = (titleEl?.innerText || link.innerText || '').trim().slice(0, 200);
      // Pull every $-containing text node in the card; parser picks the lowest.
      const priceTexts = (card.innerText || '')
        .split(/\n+/)
        .map((s) => s.trim())
        .filter((s) => /\$/.test(s));
      seen.add(href);
      out.push({ href, title, imgSrc, priceTexts });
    }
    return out;
  });
}

export async function scrapeTileCloud() {
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
    await ctx.route('**/*', async (route) => {
      const t = route.request().resourceType();
      try {
        if (t === 'image' || t === 'media' || t === 'font') await route.abort();
        else await route.continue();
      } catch {
        /* tear-down race — ignore */
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
      console.log(`[${RETAILER}] === ${plp.path} ===`);
      let plpCards = 0;
      for (let p = 1; p <= MAX_PAGES_PER_PLP && plpCards < plp.cap * 2; p++) {
        const url = p === 1 ? plpUrl : `${plpUrl}?page=${p}`;
        console.log(`[${RETAILER}] PLP page ${p}: ${url}`);
        try {
          const pageCards = await extractCardsFromPage(page, url);
          if (pageCards.length === 0) {
            console.log(`[${RETAILER}] page ${p} returned 0 cards — stopping`);
            break;
          }
          let newThisPage = 0;
          for (const c of pageCards) {
            if (!c.href || seenHrefs.has(c.href)) continue;
            if (c.title && EXCLUDE_PATTERNS.test(c.title)) continue;
            if (c.href && EXCLUDE_PATTERNS.test(c.href)) continue;
            seenHrefs.add(c.href);
            cards.push({
              ...c,
              category: plp.category,
              sourceCap: plp.cap,
              sourcePlp: plp.path,
            });
            plpCards++;
            newThisPage++;
          }
          if (newThisPage === 0) {
            console.log(`[${RETAILER}] page ${p} added 0 new cards — stopping (pagination exhausted)`);
            break;
          }
          await delay();
        } catch (err) {
          errors.push({ url, error: String(err?.message ?? err) });
        }
      }
      console.log(`[${RETAILER}] ${plp.path}: ${plpCards} new`);
    }

    console.log(`[${RETAILER}] ${cards.length} unique tiles across all PLPs`);

    await ctx.close();

    const perPlpCount = new Map();
    const products = [];
    for (const c of cards) {
      const used = perPlpCount.get(c.sourcePlp) ?? 0;
      if (used >= c.sourceCap) continue;
      perPlpCount.set(c.sourcePlp, used + 1);

      const slug = slugFromHref(c.href);
      const productUrl = c.href.startsWith('http') ? c.href : `${ORIGIN}${c.href}`;
      const heroSrc = canonicalImage(c.imgSrc);
      const { price, perSqm } = parsePricePerSqm(c.priceTexts);

      if (!heroSrc) {
        errors.push({ url: productUrl, error: 'no usable image' });
        continue;
      }

      let hero = null;
      try {
        const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
        hero = dl.localPath;
        await delay(500);
      } catch (err) {
        errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl });
      }

      // Tile dimensions sometimes appear in the title (e.g. "Stone Look
      // 600x600 Matte"); parseDimensions handles it best-effort. We
      // also stash per-sqm pricing as metadata so the picking-list UI
      // can render "from $71/m²" not "$71" (which implies total).
      products.push({
        id: slug,
        retailer: RETAILER,
        name: c.title || slug,
        category: c.category,
        price,
        currency: 'AUD',
        dimensions: { ...parseDimensions(c.title ?? ''), per_sqm: perSqm },
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: productUrl,
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
  scrapeTileCloud()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('tile cloud scrape failed', err);
      process.exit(1);
    });
}
