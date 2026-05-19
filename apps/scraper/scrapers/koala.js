// Koala — Shopify store, but the products.json endpoint is fronted by
// Cloudflare and drops bare-fetch requests at the TCP layer. The
// previous version used Node's `fetch` and got `fetch failed` with no
// HTTP status. Fix: use Playwright's browser-context API request, which
// runs through a real Chromium TLS fingerprint and gets past the WAF.
//
// Scope: sofas + beds only.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://koala.com.au';
const RETAILER = 'Koala';
const RETAILER_SLUG = 'koala';
const TARGET_MAX = 80;
const PAGE_SIZE = 50;

const ALLOWED_TYPES = ['sofa', 'sofas', 'lounge', 'bed', 'beds', 'bed-frames'];
const EXCLUDE_PATTERNS =
  /(mattress|topper|protector|pillow|sheet|quilt|cover|valance|frame-only|spare|accessory|pack)/i;

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function pickPrice(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const first = variants.find((v) => v && v.price != null);
  if (!first) return null;
  const n = Number(first.price);
  return Number.isFinite(n) ? n : null;
}

function pickCategory(product) {
  const t = (product.product_type ?? '').toLowerCase();
  if (t.includes('sofa') || t.includes('lounge')) return 'Sofas';
  if (t.includes('bed')) return 'Beds';
  return 'Furniture';
}

function pickDescription(product) {
  if (!product.body_html) return null;
  return String(product.body_html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function isAllowedProduct(product) {
  if (EXCLUDE_PATTERNS.test(product.handle ?? '')) return false;
  if (EXCLUDE_PATTERNS.test(product.title ?? '')) return false;
  const type = (product.product_type ?? '').toLowerCase();
  const handle = (product.handle ?? '').toLowerCase();
  if (ALLOWED_TYPES.some((w) => type.includes(w))) return true;
  if (ALLOWED_TYPES.some((w) => handle.includes(w))) return true;
  const name = (product.title ?? '').toLowerCase();
  return /\b(sofa|couch|bed frame|bed base|bed)\b/.test(name);
}

export async function scrapeKoala() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const listUrl = `${ORIGIN}/products.json?limit=${PAGE_SIZE}`;
  if (!(await isAllowed(listUrl))) {
    console.warn(`[${RETAILER}] robots.txt disallows ${listUrl}, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });

    // First visit the homepage so the context picks up Cloudflare
    // cookies (cf_clearance + co.) before we hit the API. Without this
    // warm-up, the products.json call frequently still gets challenged.
    try {
      const page = await ctx.newPage();
      await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500); // let any Cloudflare JS challenge settle
      await page.close();
    } catch (err) {
      console.warn(`[${RETAILER}] homepage warm-up failed: ${err.message}`);
    }

    // Paginate products.json via the browser-context API request — runs
    // through Chromium's TLS fingerprint and inherits the cookies.
    const collected = [];
    for (let pageNum = 1; collected.length < TARGET_MAX * 2 && pageNum < 12; pageNum++) {
      const pageUrl = `${ORIGIN}/products.json?limit=${PAGE_SIZE}&page=${pageNum}`;
      console.log(`[${RETAILER}] fetching page ${pageNum}`);
      try {
        const res = await ctx.request.get(pageUrl, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok()) {
          errors.push({ url: pageUrl, error: `HTTP ${res.status()}` });
          break;
        }
        const payload = await res.json();
        const items = Array.isArray(payload?.products) ? payload.products : [];
        if (items.length === 0) break;
        collected.push(...items.filter(isAllowedProduct));
        await delay();
      } catch (err) {
        errors.push({ url: pageUrl, error: String(err?.message ?? err) });
        break;
      }
    }

    console.log(`[${RETAILER}] ${collected.length} candidate products after filtering`);

    const products = [];
    for (const p of collected.slice(0, TARGET_MAX)) {
      const slug = p.handle || slugify(p.title);
      const productUrl = `${ORIGIN}/products/${p.handle}`;
      const description = pickDescription(p);
      const heroSrc = p.images?.[0]?.src ?? null;

      let hero = null;
      if (heroSrc) {
        try {
          const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
          await delay(600);
        } catch (err) {
          errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: p.title,
        category: pickCategory(p),
        price: pickPrice(p),
        currency: 'AUD',
        dimensions: parseDimensions(`${p.title} ${description ?? ''}`),
        images: { hero, downloaded: hero != null, source: heroSrc, all: hero ? [hero] : [] },
        product_url: productUrl,
        description,
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
  scrapeKoala()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('koala scrape failed', err);
      process.exit(1);
    });
}
