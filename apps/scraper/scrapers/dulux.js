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
const TARGET_MAX = 200;

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

function collectColourUrlsFromIndex(html, hueIndex) {
  // The index page also embeds __NEXT_DATA__ with the full list of
  // colours in that hue. Pull URLs from there if available; fall back
  // to href-scan otherwise.
  const data = extractNextData(html);
  const urls = new Set();
  walkForLinks(data, urls, hueIndex);
  if (urls.size > 0) return [...urls];

  // Fallback: href regex.
  const hue = hueIndex.split('/')[2];
  const re = new RegExp(`href="(/colour/${hue}/[a-z0-9-]+/?)"`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const p = m[1].replace(/\/$/, '');
    if (p === hueIndex.replace(/\/popular$/, '')) continue;
    urls.add(`${ORIGIN}${p}`);
  }
  return [...urls];
}

function walkForLinks(node, out, hueIndex) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForLinks(item, out, hueIndex);
    return;
  }
  if (typeof node !== 'object') return;
  // Look for colour-detail slugs or full URLs embedded in props.
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (value.startsWith('/colour/')) {
        out.add(`${ORIGIN}${value.replace(/\/$/, '')}`);
      } else if (value.startsWith(`${ORIGIN}/colour/`)) {
        out.add(value.replace(/\/$/, ''));
      }
    } else if (typeof value === 'object') {
      walkForLinks(value, out, hueIndex);
    }
  }
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

export async function scrapeDulux() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

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
      const urls = collectColourUrlsFromIndex(html, hueIndex);
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
      const data = extractNextData(html);
      if (!data) {
        errors.push({ url, error: 'no __NEXT_DATA__ on page' });
        continue;
      }
      const colour = findColourObject(data);
      if (!colour) {
        errors.push({ url, error: 'no colour object in __NEXT_DATA__' });
        continue;
      }

      const name = pickName(colour);
      const hex = pickHex(colour);
      if (!name || !hex) {
        errors.push({ url, error: `incomplete colour: name=${name} hex=${hex}` });
        continue;
      }
      const atlasCode = pickAtlasCode(colour);
      const chipCode = pickChipCode(colour);
      const lrv = pickLrv(colour);
      const imageUrl = pickImageUrl(colour);

      const slug = slugFromUrl(url);
      let hero = null;
      if (imageUrl) {
        try {
          const dl = await downloadImage({ url: imageUrl, retailerDir: outDir, slug, index: 0 });
          hero = dl.localPath;
        } catch (err) {
          errors.push({ url: imageUrl, error: String(err?.message ?? err), productUrl: url });
        }
      }

      products.push({
        id: slug,
        retailer: RETAILER,
        name: atlasCode ? `${name} (${atlasCode})` : name,
        category: 'Paint',
        price: null,
        currency: 'AUD',
        // Stash colour metadata in the dimensions slot until a real
        // metadata jsonb column lands on products.
        dimensions: { hex, atlasCode, chipCode, lrv },
        images: { hero, downloaded: hero != null, source: imageUrl, all: hero ? [hero] : [] },
        product_url: url,
        description: atlasCode
          ? `Dulux ${name} — Atlas ${atlasCode}${chipCode ? `, Chip ${chipCode}` : ''}${lrv != null ? `, LRV ${lrv}` : ''}`
          : `Dulux ${name}`,
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
