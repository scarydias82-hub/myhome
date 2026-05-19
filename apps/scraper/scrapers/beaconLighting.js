// Beacon Lighting — Magento 2 SPA. JS-only product pages mean we need
// Playwright. We scope hard to desk lamps + floor lamps only per the
// product owner's directive (other lighting categories come later).
//
// Strategy: hit the sitemap to harvest product URLs, filter to those
// matching desk/floor lamp slugs, then visit each in a headless browser
// to extract title, price, image, description.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.beaconlighting.com.au';
const RETAILER = 'Beacon Lighting';
const RETAILER_SLUG = 'beacon-lighting';
const TARGET_MAX = 80;
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;

// Only desk lamps and floor lamps for the first cohort. Match URLs
// containing these tokens — Beacon's product slugs include the form
// factor (e.g. /lina-table-lamp-blue, /atticus-floor-lamp-bronze).
const LAMP_PATTERNS = [/\bfloor[-\s]?lamp/i, /\bdesk[-\s]?lamp/i, /\btask[-\s]?lamp/i];
const EXCLUDE_PATTERNS =
  /(bulb|globe|fitting|fixture|pendant|chandelier|wall[-\s]?light|ceiling[-\s]?light|outdoor|garden|smart|switch|cable|spare|replacement|accessory)/i;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Strip Magento sitemap into a list of product URLs. Sitemap index has
// child sitemaps — we recurse one level.
async function collectSitemapUrls() {
  const root = await fetchText(SITEMAP_URL);
  const urls = new Set();
  const loc = /<loc>([^<]+)<\/loc>/g;
  let m;
  const children = [];
  while ((m = loc.exec(root))) {
    const u = m[1].trim();
    if (u.endsWith('.xml')) children.push(u);
    else urls.add(u);
  }
  for (const child of children) {
    try {
      const body = await fetchText(child);
      let cm;
      const cre = /<loc>([^<]+)<\/loc>/g;
      while ((cm = cre.exec(body))) urls.add(cm[1].trim());
      await delay(400);
    } catch (err) {
      console.warn(`[${RETAILER}] failed to fetch child sitemap ${child}: ${err.message}`);
    }
  }
  return [...urls];
}

function isTargetLamp(url) {
  if (EXCLUDE_PATTERNS.test(url)) return false;
  return LAMP_PATTERNS.some((p) => p.test(url));
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('h1', { timeout: 10000 });
  } catch {
    /* page may be gated */
  }
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    const priceTexts = [...document.querySelectorAll('[class*="price"], [data-price-amount]')]
      .map((e) => e.innerText.trim())
      .filter(Boolean);
    const specEls = document.querySelectorAll(
      '.product.attribute, .additional-attributes-wrapper, [class*="specification"], [class*="dimension"]',
    );
    const specText = [...specEls].map((e) => e.innerText).join('\n').slice(0, 6000);
    const bodyTail = document.body.innerText.slice(0, 8000);
    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: document.querySelector('.fotorama__img, .product.media img, img[itemprop="image"]')?.src ?? null,
      priceTexts,
      specText: specText + '\n' + bodyTail,
    };
  });
}

function categoryFromUrl(url) {
  if (/floor[-\s]?lamp/i.test(url)) return 'Lighting';
  if (/desk[-\s]?lamp/i.test(url)) return 'Lighting';
  if (/task[-\s]?lamp/i.test(url)) return 'Lighting';
  return 'Lighting';
}

export async function scrapeBeaconLighting() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(SITEMAP_URL))) {
    console.warn(`[${RETAILER}] robots disallows sitemap, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const allUrls = await collectSitemapUrls();
  const lamps = allUrls.filter(isTargetLamp);
  console.log(`[${RETAILER}] ${allUrls.length} sitemap urls, ${lamps.length} desk/floor lamps`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
    });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    const products = [];
    const targets = lamps.slice(0, TARGET_MAX);
    for (let i = 0; i < targets.length; i++) {
      const url = targets[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProduct(page, url);
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;
        const price = parsePriceString(raw.priceTexts[0]);
        const dimensions = parseDimensions(raw.specText);
        const description = raw.ogDescription?.slice(0, 600) ?? null;

        let hero = null;
        if (heroSrc) {
          try {
            const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
            hero = dl.localPath;
          } catch (err) {
            errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: url });
          }
        }

        products.push({
          id: slug,
          retailer: RETAILER,
          name: raw.h1 ?? raw.title ?? slug,
          category: categoryFromUrl(url),
          price,
          currency: 'AUD',
          dimensions,
          images: { hero, downloaded: hero != null, source: heroSrc ?? null, all: hero ? [hero] : [] },
          product_url: url,
          description,
          scraped_at: new Date().toISOString(),
        });
        if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${targets.length}`);
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
      await delay();
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
  scrapeBeaconLighting()
    .then(({ products, errors }) => console.log(`done — ${products.length} products, ${errors.length} errors`))
    .catch((err) => {
      console.error('beacon scrape failed', err);
      process.exit(1);
    });
}
