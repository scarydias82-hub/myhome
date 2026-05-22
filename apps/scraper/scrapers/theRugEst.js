// The Rug Est (therugest.com) — premium AU handmade rug brand. Custom
// site (not Shopify/Magento/etc), no sitemap.xml, no products.json.
// URL pattern: /p/<range>/<variant> for individual rugs (depth 2).
//
// Strategy: walk /current-range to harvest all product URLs filtered
// to depth-2 paths, then visit each detail page to extract the high-
// res og:image + h1 (variant name) + the cheapest price tier (rugs
// are priced by size; we store the smallest-size price).
//
// Palette filter runs downstream at ingest.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.therugest.com';
const RETAILER = 'The Rug Est';
const RETAILER_SLUG = 'the-rug-est';
const TARGET_MAX = 150;

// Index pages that list product URLs. /current-range is the main
// catalog; /limited-edition adds the special-collaboration line.
const INDEX_PATHS = ['/current-range', '/limited-edition'];

const EXCLUDE_PATTERNS = /(last-chance|sample|swatch[-\s]?only)/i;

function slugFromUrl(url) {
  const parts = url.replace(/\/$/, '').split('/').filter(Boolean);
  // /p/<range>/<variant> → "<range>-<variant>"
  return parts.slice(-2).join('-').slice(0, 90);
}

function parsePriceLow(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const nums = prices
    .map((p) => Number(String(p).replace(/[^0-9.]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : null;
}

async function collectProductUrls(page) {
  const urls = new Set();
  for (const indexPath of INDEX_PATHS) {
    const indexUrl = `${ORIGIN}${indexPath}`;
    if (!(await isAllowed(indexUrl))) continue;
    console.log(`[${RETAILER}] index: ${indexPath}`);
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      // /p/<range>/<variant> only — depth 2 below /p/. Skip /p/<range>
      // overview pages and /p/last-chance.
      return [...document.querySelectorAll('a[href^="/p/"]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => {
          if (!h) return false;
          const parts = h.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
          return parts.length === 3 && parts[0] === 'p';
        })
        .filter((h, i, arr) => arr.indexOf(h) === i);
    });
    for (const h of found) {
      if (EXCLUDE_PATTERNS.test(h)) continue;
      urls.add(h);
    }
    await delay();
  }
  return [...urls].map((h) => `${ORIGIN}${h}`);
}

async function extractProductDetail(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const meta = (p) =>
      document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    const h1 = document.querySelector('h1')?.innerText?.trim() ?? null;
    // Capture range from breadcrumb / nav if available
    const breadcrumb = document.querySelector('[class*=breadcrumb]')?.innerText?.trim()?.slice(0, 80) ?? null;
    // Collect all $-prefixed text nodes — rugs are listed at multiple sizes
    const priceTexts = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /\$\d/.test(el.innerText || ''))
      .map((el) => el.innerText.trim())
      .filter((t) => /^\$\d/.test(t))
      .slice(0, 10);
    return {
      title: document.title,
      h1,
      breadcrumb,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      priceTexts,
    };
  });
}

export async function scrapeTheRugEst() {
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
    // Block heavy assets for the index + detail walks (we'll fetch
    // canonical product images via Node fetch in the download phase).
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet')
        return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    // 1. Harvest product URLs from index pages.
    const productUrls = await collectProductUrls(page);
    console.log(`[${RETAILER}] ${productUrls.length} variant URLs harvested`);

    // 2. Visit each detail page for name + image + price.
    const targets = productUrls.slice(0, TARGET_MAX);
    const products = [];
    let droppedNoImage = 0;
    for (let i = 0; i < targets.length; i++) {
      const url = targets[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProductDetail(page, url);
        if (!raw.ogImage) {
          droppedNoImage++;
          continue;
        }
        const name = raw.h1 ?? (raw.title || '').replace(/\s*\|\s*The Rug Est\.?\s*$/i, '').trim();
        if (!name) {
          droppedNoImage++;
          continue;
        }
        const slug = slugFromUrl(url);
        const price = parsePriceLow(raw.priceTexts);
        const heroSrc = raw.ogImage;

        let hero = null;
        try {
          const dl = await downloadImage({ url: heroSrc, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
          await delay(600);
        } catch (err) {
          errors.push({ url: heroSrc, error: String(err?.message ?? err), productUrl: url });
        }

        products.push({
          id: slug,
          retailer: RETAILER,
          name,
          category: 'Rugs',
          price,
          currency: 'AUD',
          dimensions: null,
          images: {
            hero,
            downloaded: hero != null,
            source: heroSrc,
            all: hero ? [hero] : [],
          },
          product_url: url,
          description: raw.ogDescription?.slice(0, 600) ?? null,
          market_segment: segmentFor(RETAILER),
          scraped_at: new Date().toISOString(),
        });
        if ((i + 1) % 20 === 0) console.log(`[${RETAILER}] ${i + 1}/${targets.length}`);
        await delay();
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
    }

    await writeJson(path.join(outDir, 'products.json'), products);
    if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
    console.log(
      `[${RETAILER}] wrote ${products.length} rugs, ${errors.length} errors ` +
        `(${droppedNoImage} dropped — no image)`,
    );
    return { retailer: RETAILER, products, errors };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeTheRugEst()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} rugs, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('the rug est scrape failed', err);
      process.exit(1);
    });
}
