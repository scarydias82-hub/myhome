// Poliform Australia — Shopify store. We use the public products.json
// endpoint that Shopify exposes by design, so no headless browser needed.
//
// Docs on this endpoint:
//   https://shopify.dev/docs/api/ajax/reference/product

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.poliformaustralia.com.au';
const RETAILER = 'Poliform';
const RETAILER_SLUG = 'poliform';
const TARGET_MIN = 50;
const TARGET_MAX = 100;
const PAGE_SIZE = 50;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function pickPrice(product) {
  // Shopify products.json prices are strings in major units, e.g. "1995.00".
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const first = variants.find((v) => v && v.price != null);
  if (!first) return null;
  const n = Number(first.price);
  return Number.isFinite(n) ? n : null;
}

function pickCategory(product) {
  return product.product_type || product.tags?.split(',')[0]?.trim() || 'Furniture';
}

function pickDescription(product) {
  if (!product.body_html) return null;
  return String(product.body_html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function isFurniture(product) {
  // Filter out accessories/swatches/spare parts. We want hero pieces.
  const type = (product.product_type ?? '').toLowerCase();
  const allow = ['sofa', 'chair', 'bed', 'table', 'dining', 'desk', 'wardrobe', 'storage', 'lounge'];
  if (allow.some((w) => type.includes(w))) return true;
  const name = (product.title ?? '').toLowerCase();
  return allow.some((w) => name.includes(w));
}

export async function scrapePoliform() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const listUrl = `${ORIGIN}/collections/all/products.json?limit=${PAGE_SIZE}`;
  if (!(await isAllowed(listUrl))) {
    console.warn(`[${RETAILER}] robots.txt disallows ${listUrl}, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  // Paginate via ?page=. Shopify caps page size at 250 but 50 is plenty.
  const collected = [];
  for (let page = 1; collected.length < TARGET_MAX && page < 10; page++) {
    const pageUrl = `${ORIGIN}/collections/all/products.json?limit=${PAGE_SIZE}&page=${page}`;
    if (!(await isAllowed(pageUrl))) {
      console.warn(`[${RETAILER}] robots disallows ${pageUrl}, stopping`);
      break;
    }
    console.log(`[${RETAILER}] fetching page ${page}`);
    let payload;
    try {
      payload = await fetchJson(pageUrl);
    } catch (err) {
      errors.push({ url: pageUrl, error: String(err?.message ?? err) });
      break;
    }
    const items = Array.isArray(payload?.products) ? payload.products : [];
    if (items.length === 0) break;
    collected.push(...items.filter(isFurniture));
    await delay();
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
        const dl = await downloadImage({
          url: heroSrc,
          retailerDir: outDir,
          slug,
          index: 0,
        });
        hero = dl.localPath;
        await delay(800); // lighter delay for CDN image fetches
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
      images: {
        hero,
        downloaded: hero != null,
        source: heroSrc,
        all: hero ? [hero] : [],
      },
      product_url: productUrl,
      description,
      market_segment: segmentFor(RETAILER),
      scraped_at: new Date().toISOString(),
    });
  }

  await writeJson(path.join(outDir, 'products.json'), products);
  if (errors.length > 0) {
    await writeJson(path.join(outDir, 'errors.json'), errors);
  }
  console.log(`[${RETAILER}] wrote ${products.length} products (${products.length >= TARGET_MIN ? 'target met' : 'below target'})`);
  return { retailer: RETAILER, products, errors };
}

// Allow direct execution: `node scrapers/poliform.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapePoliform()
    .then(({ products, errors }) => {
      console.log(`done — ${products.length} products, ${errors.length} errors`);
    })
    .catch((err) => {
      console.error('poliform scrape failed', err);
      process.exit(1);
    });
}
