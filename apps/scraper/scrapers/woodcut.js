// Woodcut Australia — engineered timber flooring. WordPress brochure
// site, no e-commerce, no prices. Previous version of this scraper
// looked for `/wood-finishes/<slug>/` URLs which don't exist — the
// actual product URL pattern is `/wood/<slug>/`. Fixed by reading the
// sitemap directly and filtering for that pattern (~175 product URLs
// covered, no collection-index parsing needed).

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
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Read the sitemap. It may be a sitemap index (links to child sitemaps)
// or a flat URLset. Walk one level deep.
async function collectSitemapUrls() {
  const root = await fetchText(SITEMAP_URL);
  const out = new Set();
  const re = /<loc>([^<]+)<\/loc>/g;
  const children = [];
  let m;
  while ((m = re.exec(root))) {
    const u = m[1].trim();
    if (u.endsWith('.xml')) children.push(u);
    else out.add(u);
  }
  for (const child of children) {
    try {
      const body = await fetchText(child);
      let cm;
      const cre = /<loc>([^<]+)<\/loc>/g;
      while ((cm = cre.exec(body))) out.add(cm[1].trim());
      await delay(400);
    } catch (err) {
      console.warn(`[${RETAILER}] child sitemap ${child} failed: ${err.message}`);
    }
  }
  return [...out];
}

// Product URL pattern verified from the live site: /wood/<slug>/
function isFinishUrl(url) {
  return /\/wood\/[a-z0-9-]+\/?$/i.test(url);
}

function pickFirst(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

function extractFinish(html) {
  const name =
    pickFirst(html, /<h1[^>]*>([^<]+)<\/h1>/i) ??
    pickFirst(html, /<meta property="og:title" content="([^"]+)"/i);
  const description =
    pickFirst(html, /<meta name="description" content="([^"]+)"/i) ??
    pickFirst(html, /<meta property="og:description" content="([^"]+)"/i);
  const imageUrl =
    pickFirst(html, /<meta property="og:image" content="([^"]+)"/i) ??
    pickFirst(
      html,
      /(https:\/\/woodcut\.com\.au\/wp-content\/uploads\/[^"\s)]+\.(?:jpe?g|png|webp))/i,
    );
  const species = pickFirst(
    html,
    /\b(European Oak|American Walnut|American Oak|European Walnut|Spotted Gum|Tasmanian Oak|Blackbutt)\b/i,
  );
  const widthMm = pickFirst(html, /(\d{2,3})\s*mm\s*(?:wide|width|plank)/i);

  if (!name) return null;
  return {
    name: String(name).replace(/\s*\|\s*Woodcut.*$/i, '').trim(),
    species,
    widthMm: widthMm ? Number(widthMm) : null,
    imageUrl,
    description,
  };
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

export async function scrapeWoodcut() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(SITEMAP_URL))) {
    console.warn(`[${RETAILER}] robots disallows sitemap, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  let allUrls;
  try {
    allUrls = await collectSitemapUrls();
  } catch (err) {
    errors.push({ url: SITEMAP_URL, error: String(err?.message ?? err) });
    await writeJson(path.join(outDir, 'errors.json'), errors);
    return { retailer: RETAILER, products: [], errors };
  }
  const finishes = allUrls.filter(isFinishUrl);
  console.log(`[${RETAILER}] ${allUrls.length} sitemap urls, ${finishes.length} /wood/* finishes`);
  const targets = finishes.slice(0, TARGET_MAX);

  const products = [];
  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    try {
      if (!(await isAllowed(url))) continue;
      const html = await fetchText(url);
      const finish = extractFinish(html);
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
