// Coco Republic — BigCommerce store. We use their public XML sitemap to list
// product URLs (no Playwright needed), then visit each product page and
// extract the JSON-LD Product block + a structured "W: x mm x D: y mm x H: z mm"
// dimensions string that's embedded in the page data.
//
// All requests are sequential, with a polite 2.5s+ delay between page loads.

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.cocorepublic.com.au';
const RETAILER = 'Coco Republic';
const RETAILER_SLUG = 'coco-republic';
const TARGET_MAX = 100;

// Hero-furniture slugs we want. Tuned to Coco Republic's URL conventions.
const HERO_INCLUDE = /(sofa|chair|ottoman|bench|stool|armchair|tub-chair|wing-chair|bed|headboard|nightstand|bedside|dining|dining-table|coffee-table|side-table|console|sideboard|buffet|cabinet|desk|dresser)/i;
const HERO_EXCLUDE = /(swatch|sample|leg-(?:cap|extension)|cushion-?cover|throw|vase|tray|frame|candle|hook|knob|book|bowl|set-of|coaster|placemat|napkin|jewellery|jewelry|umbrella|outdoor-?rug|spare|replacement)/i;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function listProductUrls() {
  const urls = new Set();
  // Coco Republic uses paginated product sitemaps. Walk pages until empty.
  for (let page = 1; page < 20; page++) {
    const sitemapUrl = `${ORIGIN}/xmlsitemap.php?type=products&page=${page}`;
    if (!(await isAllowed(sitemapUrl))) {
      console.warn(`[${RETAILER}] robots disallows ${sitemapUrl}, stopping`);
      break;
    }
    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch {
      break;
    }
    const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (found.length === 0) break;
    for (const u of found) urls.add(u);
    console.log(`[${RETAILER}] sitemap page ${page}: ${found.length} urls (running total ${urls.size})`);
    await delay();
    if (found.length < 100) break; // last page typically partial
  }
  return [...urls];
}

function decodeMaybeEncoded(s) {
  if (!s) return s;
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function extractJsonLdProduct(html) {
  const matches = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1].trim());
      const candidates = Array.isArray(data) ? data : [data];
      for (const c of candidates) {
        if (c && (c['@type'] === 'Product' || (Array.isArray(c['@type']) && c['@type'].includes('Product')))) {
          return c;
        }
      }
    } catch {
      // ignore malformed blocks; keep scanning
    }
  }
  return null;
}

// Coco Republic embeds Salsify-style product detail data inside the page,
// with entries shaped like:
//   {"name":"OVERALL DIMENSIONS","value":"W: 1010 mm x D: 980 mm x H: 850 mm"}
// The block is JSON-in-JSON-in-JSON, so quotes arrive *triple*-escaped
// (\\\"). Iteratively flatten the escaping until it stabilises, then match.
function extractDimensions(html) {
  let text = html;
  for (let i = 0; i < 6; i++) {
    const next = text.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    if (next === text) break;
    text = next;
  }
  const m = text.match(/"name"\s*:\s*"(?:OVERALL\s+)?DIMENSIONS"\s*,\s*"value"\s*:\s*"([^"]+)"/i);
  if (!m) return { width_cm: null, depth_cm: null, height_cm: null };
  const value = m[1];
  const pick = (regex) => {
    const r = value.match(regex);
    if (!r) return null;
    const n = Number(r[1]);
    if (!Number.isFinite(n)) return null;
    const lower = value.toLowerCase();
    return lower.includes('mm') ? Math.round(n / 10) : n;
  };
  return {
    width_cm: pick(/W[: ]*(\d+(?:\.\d+)?)/i),
    depth_cm: pick(/D[: ]*(\d+(?:\.\d+)?)/i),
    height_cm: pick(/H[: ]*(\d+(?:\.\d+)?)/i),
  };
}

function categoryFromUrl(url) {
  const u = url.toLowerCase();
  if (/\bsofa(?:bed)?s?\b|chesterfield|modular/.test(u)) return 'Sofas';
  if (/dining/.test(u)) return 'Dining';
  if (/coffee-table|coffee_table/.test(u)) return 'Coffee Tables';
  if (/side-table|console|sideboard|buffet/.test(u)) return 'Occasional Tables';
  if (/bed\b|headboard|nightstand|bedside/.test(u)) return 'Beds';
  if (/chair|stool|ottoman|bench/.test(u)) return 'Chairs';
  if (/desk|dresser|cabinet|wardrobe/.test(u)) return 'Storage & Desks';
  return 'Furniture';
}

function slugFromUrl(url) {
  const last = url.split('/').pop().replace(/\.html.*$/i, '');
  return last.replace(/^\d+-/, '').slice(0, 80);
}

export async function scrapeCocoRepublic() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const all = await listProductUrls();
  console.log(`[${RETAILER}] ${all.length} total products in sitemap`);
  const heroUrls = all.filter((u) => HERO_INCLUDE.test(u) && !HERO_EXCLUDE.test(u));
  console.log(`[${RETAILER}] ${heroUrls.length} hero-category urls after filtering`);
  const targetUrls = heroUrls.slice(0, TARGET_MAX);

  const products = [];
  for (let i = 0; i < targetUrls.length; i++) {
    const url = targetUrls[i];
    try {
      if (!(await isAllowed(url))) {
        console.warn(`[${RETAILER}] skip (robots): ${url}`);
        continue;
      }
      const html = await fetchText(url);
      const ld = extractJsonLdProduct(html);
      if (!ld) {
        errors.push({ url, error: 'no JSON-LD Product block' });
        continue;
      }
      const slug = slugFromUrl(url);
      const description = decodeMaybeEncoded(ld.description ?? '').replace(/\s+/g, ' ').trim() || null;
      const heroSrc = Array.isArray(ld.image) ? ld.image[0] : ld.image;
      const price = ld.offers?.price ? Number(ld.offers.price) : null;
      const dimensions = extractDimensions(html);

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
          await delay(800);
        } catch (err) {
          errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: url });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: ld.name,
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
        description: description?.slice(0, 600) ?? null,
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${targetUrls.length} scraped`);
    } catch (err) {
      errors.push({ url, error: String(err?.message ?? err) });
    }
    await delay();
  }

  await writeJson(path.join(outDir, 'products.json'), products);
  if (errors.length > 0) {
    await writeJson(path.join(outDir, 'errors.json'), errors);
  }
  console.log(`[${RETAILER}] wrote ${products.length} products, ${errors.length} errors`);
  return { retailer: RETAILER, products, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCocoRepublic()
    .then(({ products, errors }) => {
      console.log(`done — ${products.length} products, ${errors.length} errors`);
    })
    .catch((err) => {
      console.error('coco republic scrape failed', err);
      process.exit(1);
    });
}
