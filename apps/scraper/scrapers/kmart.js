// Kmart — Next.js SSR storefront fronted by Akamai. The homepage
// returns clean 200s but category listings get a 403 from Akamai's
// edge bot wall until a session has computed the `_abck` sensor cookie
// (real-browser JS only). Direct curl + Chrome UA does not pass; a
// real Chromium context does.
//
// Narrow scope per owner: ultra-budget accent line, **stools only**.
// Kmart's stool catalogue (bar stools + step stools + counter stools)
// is the natural complement to the rest of the segment rollout — the
// other budget retailers don't carry sub-$100 accent stools and the
// upper-mid catalogues have no presence in that price band.
//
// Strategy: lean. The category page hydrates product cards in the
// rendered DOM with the listing-level data we need (name, price,
// image, product URL). For sub-$100 stools we don't need per-product
// detail visits — dimensions and full descriptions are overkill for a
// step stool. That keeps the request count to ~1 page visit total
// and minimises Akamai pressure.
//
// Tier: ultra-budget.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.kmart.com.au';
const RETAILER = 'Kmart';
const RETAILER_SLUG = 'kmart';
const TARGET_MAX = 50;
const CATEGORY_URL = `${ORIGIN}/category/home-and-living/stools/`;
const CATEGORY = 'Stools';

// Kmart product URLs end with a numeric id slug: `/product/<words>-<id>/`.
// The id is 7–9 digits; we use it as the local product id since it's
// the stable Kmart SKU equivalent.
const PRODUCT_HREF_RE = /\/product\/[a-z0-9-]+-(\d{7,9})\/?$/i;
const PRODUCT_SELECTOR = 'a[href*="/product/"]';

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  // Pull the slug + id segment, drop trailing slash.
  const m = url.match(/\/product\/([a-z0-9-]+-\d{7,9})\/?$/i);
  return m ? m[1].slice(0, 80) : url.split('/').filter(Boolean).pop().slice(0, 80);
}

// Listing-card harvester: runs in the page context and walks every
// `a[href*="/product/"]` ancestor block to extract name, price, image,
// product URL. Kmart's category cards don't expose stable class names,
// so we read by structural relationship: image inside the anchor, price
// in the nearest sibling/descendant with a `$` pattern, name from the
// anchor's text or `aria-label`.
async function harvestCards(page) {
  return page.evaluate(({ sel }) => {
    const text = (el) => (el?.innerText ?? el?.textContent ?? '').trim();
    const cards = [];
    const seen = new Set();
    for (const a of document.querySelectorAll(sel)) {
      const href = a.href;
      if (!href || !/\/product\//.test(href)) continue;
      const clean = href.split('?')[0].split('#')[0].replace(/\/$/, '');
      if (seen.has(clean)) continue;
      seen.add(clean);

      // Image — prefer the anchor's own <img>, fallback to nearest
      // ancestor's first img (Kmart sometimes wraps the image and
      // the title in sibling divs under a common parent).
      const img =
        a.querySelector('img') ?? a.closest('article, li, div')?.querySelector('img');
      const imgSrc = img?.src ?? img?.dataset?.src ?? null;

      // Name — prefer aria-label (Kmart often labels product anchors
      // with the full product name for a11y), fall back to text.
      const ariaName = a.getAttribute('aria-label');
      const name = (ariaName ?? text(a) ?? '').replace(/\s+/g, ' ').trim();

      // Price — search the nearest card-shaped ancestor for a $ pattern.
      const parent = a.closest('article, li, div, section');
      const priceText = parent ? text(parent) : '';
      const priceMatch = priceText.match(/\$\s*\d+(?:\.\d{1,2})?/);

      cards.push({
        href: clean,
        name: name.slice(0, 200),
        imgSrc,
        priceText: priceMatch ? priceMatch[0] : null,
      });
    }
    return cards;
  }, { sel: PRODUCT_SELECTOR });
}

export async function scrapeKmart() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(CATEGORY_URL))) {
    console.warn(`[${RETAILER}] robots disallows ${CATEGORY_URL}, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets we don't need while harvesting card data; we
    // download hero images via the storage util after we know which
    // URLs we want.
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });

    // Akamai warm-up. The homepage's sensor JS computes the value the
    // `_abck` cookie needs to be in to pass the edge wall. Without
    // this visit, the category page returns 403 ("Access Denied" with
    // the edgesuite.net reference id).
    try {
      const warm = await ctx.newPage();
      await warm.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await warm.waitForTimeout(3500);
      await warm.close();
    } catch (err) {
      console.warn(`[${RETAILER}] homepage warm-up failed: ${err.message}`);
    }

    const page = await ctx.newPage();

    console.log(`[${RETAILER}] ${CATEGORY}: loading ${CATEGORY_URL}`);
    let status = 0;
    try {
      const resp = await page.goto(CATEGORY_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      status = resp?.status() ?? 0;
    } catch (err) {
      errors.push({ url: CATEGORY_URL, error: String(err?.message ?? err) });
    }

    if (status >= 400) {
      console.warn(`[${RETAILER}] category page returned ${status} — likely Akamai block`);
      errors.push({ url: CATEGORY_URL, error: `category page status ${status}` });
      await writeJson(path.join(outDir, 'errors.json'), errors);
      return { retailer: RETAILER, products: [], errors };
    }

    try {
      await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 18000 });
    } catch {
      /* hydration may be slow; the scroll loop still gives lazy-mount
         cards a chance to appear */
    }

    // Scroll to mount lazy-loaded cards. Kmart's listing pages
    // virtualise after the initial chunk; ~10 viewport-heights
    // typically covers a category's full inventory.
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(900);
    }

    const cards = await harvestCards(page);
    console.log(`[${RETAILER}] ${CATEGORY}: harvested ${cards.length} cards`);

    // Filter to true product URLs (anchor selector is greedy and may
    // pick up "view more" / "related products" links elsewhere on
    // the page that happen to start with /product/).
    const valid = cards.filter((c) => PRODUCT_HREF_RE.test(c.href));
    const slice = valid.slice(0, TARGET_MAX);

    const products = [];
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      const slug = slugFromUrl(c.href);
      const heroSrc = c.imgSrc;
      const price = parsePriceString(c.priceText);

      let hero = null;
      if (heroSrc) {
        try {
          const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
          await delay(500);
        } catch (err) {
          errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: c.href });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: c.name || slug,
        category: CATEGORY,
        price: Number.isFinite(price) ? price : null,
        currency: 'AUD',
        // Listing cards don't expose dimensions — leave null.
        // Sub-$100 stools don't need precise specs for the picking
        // list anyway; if we need them later we can add per-product
        // detail visits.
        dimensions: parseDimensions(c.name ?? ''),
        images: { hero, downloaded: hero != null, source: heroSrc ?? null, all: hero ? [hero] : [] },
        product_url: c.href,
        description: null,
        market_segment: segmentFor(RETAILER),
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
  scrapeKmart()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('kmart scrape failed', err);
      process.exit(1);
    });
}
