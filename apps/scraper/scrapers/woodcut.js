// Woodcut Australia — engineered timber flooring brand. Brochure-style
// WordPress site with no e-commerce and no prices (typical for trade
// flooring). We scrape the collection landing pages, follow each finish
// URL, and extract finish name, species, image, and product page url.
// price_aud is null (quote-based — flooring is sold by the square metre).

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://woodcut.com.au';
const RETAILER = 'Woodcut';
const RETAILER_SLUG = 'woodcut';
const TARGET_MAX = 80;

const COLLECTION_INDICES = [
  '/premium-collection/',
  '/essence-collection/',
  '/french-collection/',
  '/grande-ville-collection/',
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function pickAll(html, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(html))) out.push(m[1]);
  return out;
}

function pickFirst(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

// Collect finish URLs from a collection index. Woodcut's finish detail
// pages live at /wood-finishes/<slug>/ — links from collection pages
// point at those.
function collectFinishUrls(html) {
  const re = /href="((?:https:\/\/woodcut\.com\.au)?\/wood-finishes\/[a-z0-9-]+\/?)"/gi;
  const out = new Set();
  const found = pickAll(html, re);
  for (const href of found) {
    const url = href.startsWith('http') ? href : `${ORIGIN}${href}`;
    out.add(url.replace(/\/$/, '/'));
  }
  return [...out];
}

function extractFinish(html, url) {
  const name = pickFirst(html, /<h1[^>]*>([^<]+)<\/h1>/i) ||
    pickFirst(html, /<meta property="og:title" content="([^"]+)"/i);
  const description = pickFirst(html, /<meta name="description" content="([^"]+)"/i) ||
    pickFirst(html, /<meta property="og:description" content="([^"]+)"/i);
  // Hero image — WordPress media. Prefer og:image since the layout puts
  // multiple swatches on the page.
  const imageUrl = pickFirst(html, /<meta property="og:image" content="([^"]+)"/i) ||
    pickFirst(html, /(https:\/\/woodcut\.com\.au\/wp-content\/uploads\/[^"\s)]+\.(?:jpe?g|png|webp))/i);
  // Species — often appears in the page body, e.g. "European Oak" / "American Walnut"
  const species = pickFirst(html, /\b(European Oak|American Walnut|American Oak|European Walnut|Spotted Gum|Tasmanian Oak|Blackbutt)\b/i);
  // Plank width — typical Woodcut spec mentions 150mm / 190mm / 220mm widths
  const widthMm = pickFirst(html, /(\d{2,3})\s*mm\s*(?:wide|width|plank)/i);

  if (!name) return null;

  return {
    name,
    species,
    widthMm: widthMm ? Number(widthMm) : null,
    imageUrl,
    description,
  };
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

function categoryFromCollection(collectionPath) {
  // All finishes from Woodcut land under "Flooring" in our catalogue.
  return 'Flooring';
}

export async function scrapeWoodcut() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  // Harvest finish URLs from each collection.
  const finishUrls = new Set();
  for (const indexPath of COLLECTION_INDICES) {
    const indexUrl = `${ORIGIN}${indexPath}`;
    if (!(await isAllowed(indexUrl))) {
      console.warn(`[${RETAILER}] robots disallows ${indexUrl}, skipping`);
      continue;
    }
    try {
      console.log(`[${RETAILER}] fetching ${indexPath}`);
      const html = await fetchText(indexUrl);
      const urls = collectFinishUrls(html);
      console.log(`[${RETAILER}]   ${urls.length} finishes`);
      for (const u of urls) finishUrls.add(u);
      await delay();
    } catch (err) {
      errors.push({ url: indexUrl, error: String(err?.message ?? err) });
    }
  }

  console.log(`[${RETAILER}] ${finishUrls.size} unique finish urls`);
  const targets = [...finishUrls].slice(0, TARGET_MAX);

  const products = [];
  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    try {
      if (!(await isAllowed(url))) continue;
      const html = await fetchText(url);
      const finish = extractFinish(html, url);
      if (!finish) {
        errors.push({ url, error: 'could not parse finish from html' });
        continue;
      }

      const slug = slugFromUrl(url);
      let hero = null;
      if (finish.imageUrl) {
        try {
          const dl = await downloadImage({ url: finish.imageUrl, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
        } catch (err) {
          errors.push({ url: finish.imageUrl, error: String(err?.message ?? err), productUrl: url });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: finish.species ? `${finish.name} — ${finish.species}` : finish.name,
        category: 'Flooring',
        price: null,
        currency: 'AUD',
        dimensions: { plankWidthMm: finish.widthMm ?? null },
        images: { hero, downloaded: hero != null, source: finish.imageUrl, all: hero ? [hero] : [] },
        product_url: url,
        description: (finish.description ?? `${finish.name} engineered timber flooring`).slice(0, 600),
        scraped_at: new Date().toISOString(),
      });
      if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${targets.length}`);
      await delay();
    } catch (err) {
      errors.push({ url, error: String(err?.message ?? err) });
    }
  }

  await writeJson(path.join(outDir, 'products.json'), products);
  if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
  console.log(`[${RETAILER}] wrote ${products.length} finishes, ${errors.length} errors`);
  return { retailer: RETAILER, products, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeWoodcut()
    .then(({ products, errors }) => console.log(`done — ${products.length} finishes, ${errors.length} errors`))
    .catch((err) => {
      console.error('woodcut scrape failed', err);
      process.exit(1);
    });
}
