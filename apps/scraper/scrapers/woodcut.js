// Woodcut Australia — WordPress brochure site, no e-commerce, no prices.
// The previous version tried to read /sitemap.xml directly with Node
// `fetch` and got a 403 HTML page back (Woodcut's WAF blocks bare
// fetches). Fix: use Playwright with a real browser fingerprint to
// load collection pages, harvest the `/wood/<slug>/` product hrefs
// from the rendered DOM, then visit each product page.
//
// Collection slugs verified live: premium / essence / french /
// grande-ville. URLs land at `/wood/<slug>/` (NOT /wood-finishes/).

import path from 'node:path';
import { chromium } from 'playwright';
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

async function collectFinishUrlsFromPage(page, indexUrl) {
  try {
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch {
    return [];
  }
  // WordPress index pages render synchronously — just let the DOM settle.
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      // Accept absolute or relative; normalise to absolute https://.
      const m = href.match(/^(?:https:\/\/woodcut\.com\.au)?(\/wood\/[a-z0-9-]+\/?)$/i);
      if (!m) continue;
      seen.add(`https://woodcut.com.au${m[1].replace(/\/$/, '/')}`);
    }
    return [...seen];
  });
}

async function extractFinish(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) =>
      document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    const body = document.body.innerText.slice(0, 4000);
    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description') ?? meta('description'),
      heroImg:
        document.querySelector(
          'img[src*="/wp-content/uploads/"][src*="-scaled"], .product-image img, .featured-image img',
        )?.src ?? null,
      body,
    };
  });
}

function speciesFromBody(body) {
  const m = body.match(
    /\b(European Oak|American Walnut|American Oak|European Walnut|Spotted Gum|Tasmanian Oak|Blackbutt)\b/i,
  );
  return m ? m[1] : null;
}

function widthMmFromBody(body) {
  const m = body.match(/(\d{2,3})\s*mm\s*(?:wide|width|plank)/i);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

export async function scrapeWoodcut() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    // Block heavy assets during browsing; image binaries get downloaded
    // separately via downloadImage so we still get them.
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // Warm-up — homepage establishes any cookies the WAF wants.
    try {
      await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
    } catch (err) {
      console.warn(`[${RETAILER}] homepage warm-up failed: ${err.message}`);
    }

    const finishUrls = new Set();
    for (const indexPath of COLLECTION_INDICES) {
      const indexUrl = `${ORIGIN}${indexPath}`;
      if (!(await isAllowed(indexUrl))) {
        console.warn(`[${RETAILER}] robots disallows ${indexUrl}, skipping`);
        continue;
      }
      console.log(`[${RETAILER}] fetching ${indexPath}`);
      const urls = await collectFinishUrlsFromPage(page, indexUrl);
      console.log(`[${RETAILER}]   ${urls.length} finishes`);
      for (const u of urls) finishUrls.add(u);
      await delay();
    }

    console.log(`[${RETAILER}] ${finishUrls.size} unique finish urls`);
    const targets = [...finishUrls].slice(0, TARGET_MAX);

    const products = [];
    for (let i = 0; i < targets.length; i++) {
      const url = targets[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractFinish(page, url);
        if (!raw.h1) {
          errors.push({ url, error: 'no h1 — page may be blocked' });
          continue;
        }
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;
        const species = speciesFromBody(raw.body);
        const widthMm = widthMmFromBody(raw.body);
        const name = raw.h1.replace(/\s*\|\s*Woodcut.*$/i, '').trim();

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
          } catch (err) {
            errors.push({
              url: heroSrc,
              error: String(err?.message ?? err),
              productUrl: url,
            });
          }
        }

        products.push({
          id: slug,
          retailer: RETAILER,
          name: species ? `${name} — ${species}` : name,
          category: 'Flooring',
          price: null,
          currency: 'AUD',
          dimensions: { plankWidthMm: widthMm ?? null },
          images: {
            hero,
            downloaded: hero != null,
            source: heroSrc,
            all: hero ? [hero] : [],
          },
          product_url: url,
          description: (raw.ogDescription ?? `${name} engineered timber flooring`).slice(0, 600),
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
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeWoodcut()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} finishes, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('woodcut scrape failed', err);
      process.exit(1);
    });
}
