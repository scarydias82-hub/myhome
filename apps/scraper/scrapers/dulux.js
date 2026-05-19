// Dulux Australia — paint colour library. Not normal e-commerce: products
// are paint *colours*, not SKUs with prices. Each colour has a name,
// Atlas code, chip code, hex code, RGB, LRV, and a swatch image.
//
// Scraping strategy: hit category index pages (whites-and-neutrals,
// greys, blues, etc.), harvest individual colour URLs, then fetch each
// colour page and parse hex / image / metadata out of server-rendered
// HTML (Next.js + Contentful — no JS required to read the data).
//
// price_aud is always null. The "product" is the colour, not a tin.
// Eventually we'll wire this into a separate paint-matching surface
// (not the picking list, which is for furniture/decor).

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.dulux.com.au';
const RETAILER = 'Dulux';
const RETAILER_SLUG = 'dulux';
const TARGET_MAX = 200;

// The Dulux colour library is organised by hue. We hit each index and
// follow the popular sub-page which lists the full grid of colours.
const HUE_INDICES = [
  '/colour/whites-and-neutrals/popular',
  '/colour/greys/popular',
  '/colour/blues/popular',
  '/colour/greens/popular',
  '/colour/yellows/popular',
  '/colour/reds/popular',
  '/colour/oranges/popular',
  '/colour/purples/popular',
  '/colour/browns/popular',
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Extract colour-detail URLs from an index page. We look for hrefs that
// match the /colour/<hue>/<slug>/ pattern.
function collectColourUrls(html, hueIndex) {
  const out = new Set();
  const hue = hueIndex.split('/')[2]; // e.g. "whites-and-neutrals"
  const re = new RegExp(`href="(/colour/${hue}/[a-z0-9-]+/?)"`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/\/$/, '');
    if (path === hueIndex.replace(/\/popular$/, '')) continue;
    out.add(`${ORIGIN}${path}`);
  }
  return [...out];
}

function pickFirst(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

function extractColour(html, url) {
  // The colour name is typically the h1 or og:title.
  const name =
    pickFirst(html, /<h1[^>]*>([^<]+)<\/h1>/i) ||
    pickFirst(html, /<meta property="og:title" content="([^"]+)"/i);

  // Hex code shows up in a swatch style attribute, e.g. style="background-color:#a6acb1"
  const hex =
    pickFirst(html, /background-color:\s*(#[0-9a-f]{6})/i) ||
    pickFirst(html, /background:\s*(#[0-9a-f]{6})/i) ||
    pickFirst(html, /"hex":\s*"(#[0-9a-f]{6})"/i);

  // Atlas + chip codes — e.g. "SG6G2" and "GR21"
  const atlasCode = pickFirst(html, /Atlas Code[:\s]*<[^>]*>\s*([A-Z0-9]+)/i) ||
    pickFirst(html, /atlasCode[":]+\s*"?([A-Z0-9]+)"?/i);
  const chipCode = pickFirst(html, /Chip Code[:\s]*<[^>]*>\s*([A-Z0-9]+)/i) ||
    pickFirst(html, /chipCode[":]+\s*"?([A-Z0-9]+)"?/i);

  // LRV (Light Reflectance Value) — useful for designer reads.
  const lrv = pickFirst(html, /LRV[:\s]*<[^>]*>\s*([0-9.]+)/i);

  // Swatch image — Contentful CDN url
  const imageUrl =
    pickFirst(html, /(https:\/\/images\.ctfassets\.net\/[^"\s)]+)/i) ||
    pickFirst(html, /<meta property="og:image" content="([^"]+)"/i);

  if (!name || !hex) return null;

  return {
    name,
    hex,
    atlasCode,
    chipCode,
    lrv: lrv ? Number(lrv) : null,
    imageUrl,
    url,
  };
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

export async function scrapeDulux() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  // Harvest colour URLs from each hue index.
  const allColourUrls = new Set();
  for (const hueIndex of HUE_INDICES) {
    const indexUrl = `${ORIGIN}${hueIndex}`;
    if (!(await isAllowed(indexUrl))) {
      console.warn(`[${RETAILER}] robots disallows ${indexUrl}, skipping`);
      continue;
    }
    try {
      console.log(`[${RETAILER}] fetching ${hueIndex}`);
      const html = await fetchText(indexUrl);
      const urls = collectColourUrls(html, hueIndex);
      console.log(`[${RETAILER}]   ${urls.length} colours`);
      for (const u of urls) allColourUrls.add(u);
      await delay();
    } catch (err) {
      errors.push({ url: indexUrl, error: String(err?.message ?? err) });
    }
  }

  console.log(`[${RETAILER}] ${allColourUrls.size} unique colour urls`);
  const targets = [...allColourUrls].slice(0, TARGET_MAX);

  const products = [];
  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    try {
      if (!(await isAllowed(url))) continue;
      const html = await fetchText(url);
      const colour = extractColour(html, url);
      if (!colour) {
        errors.push({ url, error: 'could not parse name+hex from html' });
        continue;
      }

      const slug = slugFromUrl(url);
      let hero = null;
      if (colour.imageUrl) {
        try {
          const dl = await downloadImage({ url: colour.imageUrl, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
        } catch (err) {
          errors.push({ url: colour.imageUrl, error: String(err?.message ?? err), productUrl: url });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: `${colour.name}${colour.atlasCode ? ` (${colour.atlasCode})` : ''}`,
        category: 'Paint',
        price: null,
        currency: 'AUD',
        // Stash colour metadata in the dimensions slot until we add a real
        // metadata jsonb column on products. Downstream consumers can pluck
        // hex/lrv/codes from here.
        dimensions: {
          hex: colour.hex,
          atlasCode: colour.atlasCode,
          chipCode: colour.chipCode,
          lrv: colour.lrv,
        },
        images: { hero, downloaded: hero != null, source: colour.imageUrl, all: hero ? [hero] : [] },
        product_url: url,
        description: colour.atlasCode
          ? `Dulux ${colour.name} — Atlas ${colour.atlasCode}${colour.chipCode ? `, Chip ${colour.chipCode}` : ''}${colour.lrv != null ? `, LRV ${colour.lrv}` : ''}`
          : `Dulux ${colour.name}`,
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 25 === 0) console.log(`[${RETAILER}] ${i + 1}/${targets.length}`);
      await delay();
    } catch (err) {
      errors.push({ url, error: String(err?.message ?? err) });
    }
  }

  await writeJson(path.join(outDir, 'products.json'), products);
  if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
  console.log(`[${RETAILER}] wrote ${products.length} colours, ${errors.length} errors`);
  return { retailer: RETAILER, products, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeDulux()
    .then(({ products, errors }) => console.log(`done — ${products.length} colours, ${errors.length} errors`))
    .catch((err) => {
      console.error('dulux scrape failed', err);
      process.exit(1);
    });
}
