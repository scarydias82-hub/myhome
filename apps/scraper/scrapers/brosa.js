// Brosa — acquired by Kogan after late-2024 administration; the
// storefront is back online at brosa.com.au under Kogan ownership.
// Platform is unknown post-acquisition (likely shares Kogan's stack)
// and the site is fronted by **DataDome** bot protection — every
// non-browser request gets a 403 + JS challenge interstitial,
// including curl with Chrome UA and the public sitemap.
//
// Strategy: vanilla Playwright with a real Chromium TLS fingerprint
// is the lowest-friction attempt. DataDome's JS challenge auto-solves
// in a real browser context most of the time. If the homepage warm-up
// returns the challenge HTML instead of a hydrated page, we abort
// the run with a readable error so the orchestrator records it and
// the next attempt can decide whether to invest in a stealth-plugin
// bypass.
//
// URL guess: the pre-Kogan Brosa used `/buy/<slug>` collection paths,
// and the post-Kogan robots.txt confirms `/br/buy/...` as a real path
// space (`Disallow: /br/buy/lookup` etc.). Best guess: `/buy/<slug>`
// at the root. We also harvest any visible `/buy/` links from the
// homepage nav as a fallback so a slightly wrong path still yields
// data — see the diagnostic log line.
//
// Tier: mid ($700–$1,500 sofas, designer-inspired).

import path from 'node:path';
import { chromium } from 'playwright';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { parseDimensions } from '../utils/parseDimensions.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.brosa.com.au';
const RETAILER = 'Brosa';
const RETAILER_SLUG = 'brosa';
const DEFAULT_PER_LANDING_MAX = 50;

// Best-guess Brosa category paths. The pre-Kogan Brosa used `/buy/<slug>`
// (custom Magento-like setup). If Kogan migrated to a different URL
// scheme, the homepage diagnostic will reveal the real shape and we
// can update this list. Each landing logs its product-url count so
// failures are visible.
const CATEGORY_LANDINGS = [
  { url: `${ORIGIN}/buy/sofas`, category: 'Sofas' },
  { url: `${ORIGIN}/buy/dining-chairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/buy/armchairs`, category: 'Chairs', max: 25 },
  { url: `${ORIGIN}/buy/bar-stools`, category: 'Stools' },
  { url: `${ORIGIN}/buy/rugs`, category: 'Rugs' },
  { url: `${ORIGIN}/buy/table-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/buy/floor-lamps`, category: 'Lamps', max: 25 },
  { url: `${ORIGIN}/buy/wall-lights`, category: 'Wall Lights' },
  { url: `${ORIGIN}/buy/beds`, category: 'Beds' },
  { url: `${ORIGIN}/buy/desks`, category: 'Desks' },
];

// DataDome's challenge page renders this string before the JS solver
// kicks in. If we see it in the warmed-up homepage HTML, we know the
// challenge didn't auto-solve in time.
const DATADOME_CHALLENGE_SIGNATURE = 'captcha-delivery.com';

// Brosa product URLs are best-effort detected — accept anything that
// links to /buy/<slug>/<product-slug> or /shop/<slug>/<product-slug>.
// We post-filter for URLs that look like product detail pages rather
// than collection pages (heuristic: product paths have ≥2 segments
// after /buy/ or /shop/).
const PRODUCT_SELECTOR = 'a[href*="/buy/"], a[href*="/shop/"], a[href*="/br/buy/"], a[href*="/br/shop/"]';
const PRODUCT_PATH_RE = /\/(br\/)?(buy|shop)\/[a-z0-9-]+\/[a-z0-9-]+/;

async function collectProductUrls(page, landingUrl) {
  try {
    await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    return [];
  }

  // If we landed on the DataDome challenge, bail early. The selector
  // wait below would time out anyway, but this surfaces the cause.
  const html = await page.content().catch(() => '');
  if (html.includes(DATADOME_CHALLENGE_SIGNATURE) && html.length < 5000) {
    console.warn(`[${RETAILER}] DataDome challenge on ${landingUrl} — Playwright did not auto-solve`);
    return [];
  }

  try {
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 18000 });
  } catch {
    /* let the scroll loop run anyway — sometimes hydration is just slow */
  }

  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
  }

  return page.evaluate(({ sel, originHost }) => {
    const seen = new Set();
    for (const a of document.querySelectorAll(sel)) {
      const href = a.href;
      if (!href) continue;
      try {
        const u = new URL(href);
        if (u.host !== originHost) continue;
        const path = u.pathname;
        // /(br/)?(buy|shop)/<collection>/<product> — at least 2 segments
        // beyond the buy/shop prefix means it's a product detail page,
        // not a collection landing.
        if (!/\/(br\/)?(buy|shop)\/[a-z0-9-]+\/[a-z0-9-]+/.test(path)) continue;
        seen.add(`${u.origin}${path}`);
      } catch {
        /* malformed URL */
      }
    }
    return [...seen];
  }, { sel: PRODUCT_SELECTOR, originHost: 'www.brosa.com.au' });
}

function parsePriceString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function slugFromUrl(url) {
  const parts = url.replace(/\/$/, '').split('/');
  return (parts[parts.length - 1] || parts[parts.length - 2] || 'product').slice(0, 80);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('h1', { timeout: 12000 });
  } catch {
    /* fall through to meta-tag extraction */
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const meta = (p) =>
      document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? null;

    const ldNodes = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((n) => {
        try { return JSON.parse(n.innerText); } catch { return null; }
      })
      .filter(Boolean);
    const flat = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') { flat.push(n); Object.values(n).forEach(walk); }
    };
    ldNodes.forEach(walk);
    const productLd = flat.find(
      (n) => n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product')),
    );
    const offer = productLd?.offers;
    const ldPrice = Array.isArray(offer) ? offer[0]?.price : offer?.price;
    const ldImage = Array.isArray(productLd?.image) ? productLd.image[0] : productLd?.image;

    return {
      h1: text('h1'),
      title: document.title,
      ogImage: meta('og:image'),
      ogDescription: meta('og:description'),
      heroImg: ldImage ?? document.querySelector('img[src*="brosa"], .product-image img, [class*="ProductImage"] img')?.src ?? null,
      ldPrice: ldPrice ?? null,
      ldName: productLd?.name ?? null,
      ldDescription: productLd?.description ?? null,
      priceTexts: [...document.querySelectorAll('[class*="price"], [class*="Price"]')]
        .map((e) => e.innerText.trim())
        .filter(Boolean),
      bodyText: document.body.innerText.slice(0, 6000),
    };
  });
}

export async function scrapeBrosa() {
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
      extraHTTPHeaders: { 'accept-language': 'en-AU,en;q=0.9' },
    });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });

    // DataDome warm-up: visit the homepage and give the challenge
    // solver 4s to attach. Then sample the DOM for any /buy/ or
    // /shop/ nav links so the run-log shows the real URL shape even
    // if the hardcoded landings turn out to be wrong.
    let datadomeBlocked = false;
    try {
      const warm = await ctx.newPage();
      await warm.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await warm.waitForTimeout(4000);
      const html = await warm.content();
      if (html.includes(DATADOME_CHALLENGE_SIGNATURE) && html.length < 5000) {
        datadomeBlocked = true;
        console.warn(`[${RETAILER}] DataDome challenge persisted after warm-up — abort recommended`);
      } else {
        const navLinks = await warm.evaluate(() => {
          const out = new Set();
          for (const a of document.querySelectorAll('a[href*="/buy/"], a[href*="/shop/"], nav a, header a')) {
            const href = a.href;
            if (!href) continue;
            try {
              const u = new URL(href);
              if (u.host === 'www.brosa.com.au' && /\/(br\/)?(buy|shop)\//.test(u.pathname)) {
                out.add(u.pathname);
              }
            } catch { /* skip */ }
          }
          return [...out].slice(0, 30);
        });
        if (navLinks.length > 0) {
          console.log(`[${RETAILER}] homepage nav links (use to validate CATEGORY_LANDINGS):`);
          for (const p of navLinks) console.log(`  ${p}`);
        }
      }
      await warm.close();
    } catch (err) {
      console.warn(`[${RETAILER}] homepage warm-up failed: ${err.message}`);
    }

    if (datadomeBlocked) {
      errors.push({ url: ORIGIN, error: 'DataDome challenge not auto-solved by vanilla Playwright' });
      await writeJson(path.join(outDir, 'errors.json'), errors);
      return { retailer: RETAILER, products: [], errors };
    }

    const page = await ctx.newPage();

    const all = [];
    for (const { url, category, max } of CATEGORY_LANDINGS) {
      console.log(`[${RETAILER}] ${category}: loading ${url}`);
      const urls = await collectProductUrls(page, url);
      console.log(`[${RETAILER}] ${category}: ${urls.length} product urls`);
      const slice = urls.slice(0, max ?? DEFAULT_PER_LANDING_MAX);
      for (const u of slice) all.push({ url: u, category });
      await delay();
    }

    const products = [];
    for (let i = 0; i < all.length; i++) {
      const { url, category } = all[i];
      try {
        if (!(await isAllowed(url))) continue;
        const raw = await extractProduct(page, url);
        const slug = slugFromUrl(url);
        const heroSrc = raw.heroImg ?? raw.ogImage;
        const price = raw.ldPrice ? Number(raw.ldPrice) : parsePriceString(raw.priceTexts[0]);
        const dimensions = parseDimensions(raw.bodyText);
        const description = (raw.ldDescription ?? raw.ogDescription ?? '').slice(0, 600);

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
          name: raw.ldName ?? raw.h1 ?? raw.title ?? slug,
          category,
          price: Number.isFinite(price) ? price : null,
          currency: 'AUD',
          dimensions,
          images: { hero, downloaded: hero != null, source: heroSrc ?? null, all: hero ? [hero] : [] },
          product_url: url,
          description,
          market_segment: segmentFor(RETAILER),
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
    console.log(`[${RETAILER}] wrote ${products.length} products, ${errors.length} errors`);
    return { retailer: RETAILER, products, errors };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeBrosa()
    .then(({ products, errors }) =>
      console.log(`done — ${products.length} products, ${errors.length} errors`),
    )
    .catch((err) => {
      console.error('brosa scrape failed', err);
      process.exit(1);
    });
}
