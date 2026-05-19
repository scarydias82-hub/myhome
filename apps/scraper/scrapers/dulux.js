// Dulux Australia — paint colour library. Next.js site that embeds the
// colour metadata as JSON inside <script id="__NEXT_DATA__">. The previous
// version of this scraper regexed against the raw HTML and ended up
// matching the page background CSS for every colour (every entry came
// out as #F7F8F4) — fixed by parsing __NEXT_DATA__ directly, which
// gives us structured colour objects with hex, atlas code, chip code,
// LRV, and the per-swatch image URL.
//
// price_aud stays null. The "product" is the colour, not a tin.

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';

const ORIGIN = 'https://www.dulux.com.au';
const RETAILER = 'Dulux';
const RETAILER_SLUG = 'dulux';
const TARGET_MAX = 1500;
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;

// Walk every colour detail page in the public sitemap. The previous
// version walked 9 `/colour/<hue>/popular` index pages and capped at
// 200 colours — which was ~7% of the Dulux range. The sitemap exposes
// 1,400+ individual colour pages publicly (no Specifier login needed,
// unlike the colour-atlas tool the brief originally pointed us at).
//
// We whitelist the hue categories that actually contain paint colours.
// Excluded categories: design-effects + textures (finishes, not solid
// colours), colour-trends + seasonal-trends (editorial pages with no
// hex), colorbond + metalshield (industrial coatings — not what the
// wall-paint picker should surface), schemes-styles + about-colour
// (meta pages with no colour data).
const ALLOWED_HUES = new Set([
  'whites-and-neutrals',
  'greys',
  'blues',
  'greens',
  'yellows',
  'reds',
  'oranges',
  'purples',
  'browns',
  'traditionals',
  'red-heart-blue-shore',
]);

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractNextData(html) {
  // Next.js always serialises its props into a single script tag.
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    return null;
  }
}

// Walk an arbitrary object tree and return the first nested object that
// looks like a Dulux colour record. Schema isn't documented so we
// pattern-match on the fields we need.
function findColourObject(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findColourObject(item);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  // A colour record has at minimum a name + a hex/rgb.
  const hasHex =
    typeof node.hex === 'string' ||
    typeof node.hexCode === 'string' ||
    typeof node.colourHex === 'string' ||
    (typeof node.rgb === 'object' && node.rgb !== null);
  const hasName =
    typeof node.name === 'string' ||
    typeof node.colourName === 'string' ||
    typeof node.title === 'string';
  if (hasHex && hasName) return node;
  for (const v of Object.values(node)) {
    const r = findColourObject(v);
    if (r) return r;
  }
  return null;
}

function pickHex(c) {
  // Possible field names in the JSON.
  const raw =
    c.hex ?? c.hexCode ?? c.colourHex ?? c.hexValue ?? (c.rgb ? rgbToHex(c.rgb) : null);
  if (!raw) return null;
  const norm = String(raw).trim().toLowerCase();
  if (norm.startsWith('#')) return norm.length === 7 ? norm : null;
  if (/^[0-9a-f]{6}$/.test(norm)) return `#${norm}`;
  return null;
}

function rgbToHex(rgb) {
  const r = Number(rgb.r ?? rgb.red ?? 0);
  const g = Number(rgb.g ?? rgb.green ?? 0);
  const b = Number(rgb.b ?? rgb.blue ?? 0);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function pickName(c) {
  const raw = c.name ?? c.colourName ?? c.title ?? null;
  if (!raw) return null;
  // Strip the " | Dulux" page-title suffix if it sneaks in.
  return String(raw).replace(/\s*\|\s*Dulux\s*$/i, '').trim();
}

function pickAtlasCode(c) {
  return c.atlasCode ?? c.atlas ?? c.code ?? null;
}

function pickChipCode(c) {
  return c.chipCode ?? c.chip ?? null;
}

function pickLrv(c) {
  const raw = c.lrv ?? c.lightReflectanceValue ?? null;
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function pickImageUrl(c) {
  // Try several shapes — Contentful often nests under `fields` or `file`.
  const direct = c.image ?? c.swatchImage ?? c.swatch ?? c.imageUrl ?? null;
  if (typeof direct === 'string') return normaliseContentful(direct);
  if (direct && typeof direct === 'object') {
    const fileUrl =
      direct.url ??
      direct.src ??
      direct.fields?.file?.url ??
      direct.file?.url ??
      null;
    if (typeof fileUrl === 'string') return normaliseContentful(fileUrl);
  }
  return null;
}

function normaliseContentful(u) {
  if (!u) return null;
  let url = u.trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!url.startsWith('http')) return null;
  // HTML-escaped ampersands break image downloads — un-escape.
  return url.replace(/&amp;/g, '&');
}

function slugFromUrl(url) {
  return url.replace(/\/$/, '').split('/').pop().slice(0, 80);
}

// Pull every colour detail URL from the sitemap whose path matches
// /colour/<allowed-hue>/<slug>/. Filters out hue indexes (depth 2),
// /popular subset pages, articles, and disallowed hue families.
async function collectColourUrlsFromSitemap() {
  const xml = await fetchText(SITEMAP_URL);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = new Set();
  const perHue = {};
  for (const u of locs) {
    const path = u.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    // /colour/<hue>/<slug> shape only — depth 3, second segment in
    // the allowed-hues whitelist.
    if (parts.length !== 3) continue;
    if (parts[0] !== 'colour') continue;
    if (parts[2] === 'popular') continue; // the curated subset page
    if (!ALLOWED_HUES.has(parts[1])) continue;
    urls.add(`${ORIGIN}${path}`);
    perHue[parts[1]] = (perHue[parts[1]] || 0) + 1;
  }
  return { urls: [...urls], perHue };
}

export async function scrapeDulux() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  if (!(await isAllowed(SITEMAP_URL))) {
    console.warn(`[${RETAILER}] robots disallows sitemap, skipping`);
    return { retailer: RETAILER, products: [], errors };
  }

  let allColourUrls = [];
  try {
    const result = await collectColourUrlsFromSitemap();
    allColourUrls = result.urls;
    console.log(`[${RETAILER}] sitemap → ${allColourUrls.length} colour URLs across ${Object.keys(result.perHue).length} hues`);
    for (const [hue, n] of Object.entries(result.perHue).sort((a, b) => b[1] - a[1])) {
      console.log(`[${RETAILER}]   ${hue.padEnd(28)} ${n}`);
    }
  } catch (err) {
    errors.push({ url: SITEMAP_URL, error: String(err?.message ?? err) });
    console.error(`[${RETAILER}] sitemap fetch failed:`, err.message);
    return { retailer: RETAILER, products: [], errors };
  }

  const targets = allColourUrls.slice(0, TARGET_MAX);

  // Per-colour fetch is just one HTML download + JSON parse — no
  // images, no auth, no JS. Running serially at the default 2.5s
  // delay would take ~75 minutes for 1,400 colours. Process in
  // parallel batches of 8 with a brief inter-batch settle so we
  // don't hammer the origin.
  const CONCURRENCY = 8;
  const BATCH_GAP_MS = 250;

  async function fetchOne(url) {
    try {
      if (!(await isAllowed(url))) return null;
      const html = await fetchText(url);
      const data = extractNextData(html);
      if (!data) {
        errors.push({ url, error: 'no __NEXT_DATA__ on page' });
        return null;
      }
      const colour = findColourObject(data);
      if (!colour) {
        errors.push({ url, error: 'no colour object in __NEXT_DATA__' });
        return null;
      }
      const name = pickName(colour);
      const hex = pickHex(colour);
      if (!name || !hex) {
        errors.push({ url, error: `incomplete colour: name=${name} hex=${hex}` });
        return null;
      }
      const atlasCode = pickAtlasCode(colour);
      const chipCode = pickChipCode(colour);
      const lrv = pickLrv(colour);
      const imageUrl = pickImageUrl(colour);
      const slug = slugFromUrl(url);
      // Skip image download — Dulux paint products use the hex
      // directly via dimensions.hex (palette-match fast path + UI
      // renders a coloured swatch). Saves ~1400 image fetches.
      return {
        id: slug,
        retailer: RETAILER,
        name: atlasCode ? `${name} (${atlasCode})` : name,
        category: 'Paint',
        price: null,
        currency: 'AUD',
        dimensions: { hex, atlasCode, chipCode, lrv },
        images: { hero: null, downloaded: false, source: imageUrl ?? null, all: [] },
        product_url: url,
        description: atlasCode
          ? `Dulux ${name} — Atlas ${atlasCode}${chipCode ? `, Chip ${chipCode}` : ''}${lrv != null ? `, LRV ${lrv}` : ''}`
          : `Dulux ${name}`,
        scraped_at: new Date().toISOString(),
      };
    } catch (err) {
      errors.push({ url, error: String(err?.message ?? err) });
      return null;
    }
  }

  const products = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchOne));
    for (const r of results) if (r) products.push(r);
    if (i % 200 === 0 && i > 0) console.log(`[${RETAILER}] ${i}/${targets.length} fetched (${products.length} kept)`);
    await delay(BATCH_GAP_MS);
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
