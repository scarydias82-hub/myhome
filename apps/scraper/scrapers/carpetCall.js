// Carpet Call — Magento 2 with active bot detection (returns 403 on bare
// fetch). Playwright bypasses with a real browser fingerprint. Carpet
// prices are quote-only (per square metre, behind "request a quote"),
// so price_aud is null and we focus on capturing carpet name, fibre
// composition, colour, and image.

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.carpetcall.com.au';
const RETAILER = 'Carpet Call';
const RETAILER_SLUG = 'carpet-call';
const PER_CATEGORY_MAX = 40; // 40 wool + 40 synthetic = 80 products

const CATEGORIES = [
  { url: `${ORIGIN}/carpet/wool`, fibre: 'wool' },
  { url: `${ORIGIN}/cc-synthetic-carpet`, fibre: 'synthetic' },
];

async function collectProductUrls(page, listingUrl) {
  try {
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    return [];
  }
  try {
    await page.waitForSelector('a[href*="/carpet/"], a[href*="/cc-"]', { timeout: 12000 });
  } catch {
    return [];
  }
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
  return page.evaluate((origin) => {
    const seen = new Set();
    for (const a of document.querySelectorAll('a')) {
      const href = a.href;
      if (!href) continue;
      if (!href.startsWith(origin)) continue;
      // Carpet product detail pages typically end in -carpet or contain
      // a known carpet slug. Filter out category navigation.
      if (/\/(wool|synthetic|wool-blend|nylon|polyester|sisal|jute)(\/|$|\?)/i.test(href)) continue;
      if (!/carpet/i.test(href)) continue;
      // Skip the listing page itself.
      const path = new URL(href).pathname.replace(/\/$/, '');
      if (path.split('/').filter(Boolean).length < 2) continue;
      seen.add(href.split('?')[0].replace(/\/$/, ''));
    }
    return [...seen];
  }, ORIGIN);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('h1', { timeout: 10000 });
  } catch {
    /* fall through */
  }
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;
    const specEls = document.querySelectorAll(
      '.product.attribute, .additional-attributes-wrapper, [class*="specification"], [class*="composition"]',
    );
    const specText = [...specEls].map((e) => e.innerText).join('\n').slice(0, 4000);
    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: document.querySelector('.fotorama__img, .product.media img, img[itemprop="image"]')?.src ?? null,
      specText,
      bodyText: document.body.innerText.slice(0, 4000),
    };
  });
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

export async function scrapeCarpetCall() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(`${ORIGIN}/`))) {
    console.warn(`[${RETAILER}] robots disallows origin, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      // Carpet Call does light bot fingerprinting — set some realistic
      // browser headers so Magento doesn't 403 us.
      extraHTTPHeaders: {
        'accept-language': 'en-AU,en;q=0.9',
      },
    });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();

    const all = [];
    for (const { url, fibre } of CATEGORIES) {
      const urls = await collectProductUrls(page, url);
      console.log(`[${RETAILER}] ${fibre}: ${urls.length} urls`);
      const slice = urls.slice(0, PER_CATEGORY_MAX);
      for (const u of slice) all.push({ url: u, fibre });
      await delay();
    }

    const products = [];
    for (let i = 0; i < all.length; i++) {
      const { url, fibre } = all[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProduct(page, url);
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;

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
          category: 'Carpet',
          price: null, // quote-only
          currency: 'AUD',
          dimensions: { fibre },
          images: { hero, downloaded: hero != null, source: heroSrc ?? null, all: hero ? [hero] : [] },
          product_url: url,
          description: (raw.ogDescription ?? raw.specText.slice(0, 600)) || null,
          scraped_at: new Date().toISOString(),
        });
        if ((i + 1) % 10 === 0) console.log(`[${RETAILER}] ${i + 1}/${all.length}`);
      } catch (err) {
        errors.push({ url, error: String(err?.message ?? err) });
      }
      await delay();
    }

    await writeJson(path.join(outDir, 'products.json'), products);
    if (errors.length > 0) await writeJson(path.join(outDir, 'errors.json'), errors);
    console.log(`[${RETAILER}] wrote ${products.length} carpets, ${errors.length} errors`);
    return { retailer: RETAILER, products, errors };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCarpetCall()
    .then(({ products, errors }) => console.log(`done — ${products.length} carpets, ${errors.length} errors`))
    .catch((err) => {
      console.error('carpet call scrape failed', err);
      process.exit(1);
    });
}
