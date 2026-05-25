// Coco Republic — BigCommerce storefront. The XML sitemap lists every
// product URL (one URL per fabric × size variant — Coco publishes per-
// variant pages rather than swatching them on one page, so per-URL
// already gives us per-variant rows naturally). For each product page
// we extract the inline `bcJsContext` JSON blob, which carries the
// full BigCommerce product object: name, sku, price, all images,
// brand, custom_fields, options, breadcrumb category path.
//
// Image strategy: BigCommerce's CDN serves images at any width via a
// `{:size}` placeholder in the URL — we substitute `2560w` for the
// largest available hi-res. Then `downloadImage({ resize: false })`
// preserves the source bytes (no Sharp resize, no JPEG re-encode) so
// the local copies are properly hi-res for vision profile + future
// render-substitution compositing.
//
// Cardinal differences from the previous JSON-LD-only version:
//   1. bcJsContext > JSON-LD — exposes all 5-20 product images, full
//      breadcrumb category path, full price model with sale/non-sale
//      pricing, structured options for the (single) variant on the
//      page, and richer custom_fields.
//   2. Multi-image — every image returned by the product, not just
//      `ld.image[0]`. Written into images.all_sources for the ingest
//      step to thread into the new products.image_urls[] column.
//   3. Hi-res — no resize step. ~500KB-2MB per image vs ~80KB
//      previously. Trade is paid in disk for vision profile fidelity.
//   4. Category mapping aligned to the owner's 9-category list:
//      Sofas, Chairs, Lounge Chairs, Dining Chairs, Dining Tables,
//      Beds, Bedside Tables, Floor Lamps, Table Lamps. Anything
//      outside that set is skipped at filter time so we don't burn
//      requests / disk on artwork, cushions, etc.
//
// All requests are sequential with a polite 2.5s+ delay between page
// loads. The full hero-furniture catalogue is ~300-600 URLs after
// filtering; expect a 20-30 minute wall-time end-to-end.

import path from 'node:path';
import { delay } from '../utils/delay.js';
import { USER_AGENT } from '../utils/userAgent.js';
import { isAllowed } from '../utils/robots.js';
import { downloadImage } from '../utils/imageDownload.js';
import { writeJson, retailerOutputDir } from '../utils/storage.js';
import { segmentFor } from '../utils/retailerSegment.js';

const ORIGIN = 'https://www.cocorepublic.com.au';
const RETAILER = 'Coco Republic';
const RETAILER_SLUG = 'coco-republic';

// Effectively uncapped — we want every hero-category product. Set to
// a high ceiling so a runaway sitemap doesn't burn the day.
const TARGET_MAX = 5000;

// Max images stored per product. The Halyard sofa surfaces 19 — we
// cap at 20 to give a small headroom while preventing the occasional
// outlier (e.g. brand collection landing page misclassified as a
// product) from dumping 100 images.
const MAX_IMAGES_PER_PRODUCT = 20;

// BigCommerce stencil URLs carry a `{:size}` template placeholder. We
// always substitute the largest standard width Coco's CDN serves.
// 2560w gives ~1.5-2MB JPEGs at native resolution.
const HI_RES_WIDTH = '2560w';

// URL-pattern pre-filter on the sitemap walk so we don't visit
// thousands of swatch / artwork / accessory pages. Exclude wins ties.
const HERO_INCLUDE = /(sofa|chair|bed|dining|lamp|nightstand|bedside|stool|ottoman|armchair|chesterfield|modular|headboard)/i;
const HERO_EXCLUDE = /(take-home-swatch|fabric-swatch|sample|leg-cap|leg-extension|cushion-cover|throw|vase|tray|frame|candle|hook|knob|book|bowl|set-of|coaster|placemat|napkin|jewellery|jewelry|umbrella|outdoor-rug|spare|replacement|wall-art|artwork|rug-pad|abstract-study|chandeli|paint)/i;

// The 9 canonical categories the owner asked for. categoryFromCoco()
// returns one of these or null (which filters the product out).
const TARGET_CATEGORIES = new Set([
  'Sofas',
  'Chairs',
  'Lounge Chairs',
  'Dining Chairs',
  'Dining Tables',
  'Beds',
  'Bedside Tables',
  'Floor Lamps',
  'Table Lamps',
]);

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Walks Coco's paginated XML sitemap and returns every product URL.
// Coco's sitemap is `xmlsitemap.php?type=products&page=N` — pages
// continue until an empty `<urlset>` is returned.
async function listProductUrls() {
  const urls = new Set();
  for (let page = 1; page < 30; page++) {
    const sitemapUrl = `${ORIGIN}/xmlsitemap.php?type=products&page=${page}`;
    if (!(await isAllowed(sitemapUrl))) {
      console.warn(`[${RETAILER}] robots disallows ${sitemapUrl}, stopping`);
      break;
    }
    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch (err) {
      console.warn(`[${RETAILER}] sitemap page ${page} failed: ${err.message}`);
      break;
    }
    const locMatches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    if (locMatches.length === 0) break;
    for (const m of locMatches) urls.add(m[1]);
    await delay(1000);
  }
  return [...urls];
}

// Extracts the embedded `bcJsContext = "..."` JS variable from a Coco
// product page and parses it into a JavaScript object.
//
// bcJsContext is a JS string literal containing a JSON string — i.e.
// double-escaped. The double-JSON-parse trick handles all the JS
// escape sequences cleanly (\n, \", \uXXXX, \/ etc.) without us
// having to enumerate them manually.
function extractBcJsContext(html) {
  // Non-greedy capture of everything between bcJsContext = "..."; .
  // The character class avoids unescaped quotes terminating the match.
  const m = html.match(/bcJsContext\s*=\s*"((?:\\.|[^"\\])*)"\s*;/);
  if (!m) return null;
  try {
    // Step 1: JSON.parse the JS string literal — turns \" back into ",
    // \n back into newline, etc. Yields the inner JSON-as-string.
    const innerJson = JSON.parse(`"${m[1]}"`);
    // Step 2: JSON.parse that string — yields the actual object.
    return JSON.parse(innerJson);
  } catch {
    return null;
  }
}

// Maps Coco's breadcrumb category array to one of the 9 target
// canonical labels. Returns null if the product doesn't fit any
// target — caller filters it out.
//
// Coco's `product.category` is an array like ["Living", "Living/Sofas",
// "Sofas", "Sofas/Modulars", ...]. We test category strings + the
// product name as a backstop.
function categoryFromCoco(p) {
  const cats = (Array.isArray(p?.category) ? p.category : []).map((c) => c.toLowerCase());
  const name = (p?.name ?? '').toLowerCase();
  const url = (p?.url ?? '').toLowerCase();
  const haystack = [...cats, name, url].join(' | ');

  // Order matters: more-specific matches before broader ones (e.g.
  // "bedside" before "bed").
  if (/bedside|nightstand/.test(haystack)) return 'Bedside Tables';
  if (/floor.lamp|floor-lamp/.test(haystack)) return 'Floor Lamps';
  if (/table.lamp|table-lamp|desk.lamp/.test(haystack)) return 'Table Lamps';
  if (/dining.chair|dining-chair/.test(haystack)) return 'Dining Chairs';
  if (/dining.table|dining-table|dining\/tables/.test(haystack)) return 'Dining Tables';
  if (/sofa|chesterfield|modular/.test(haystack)) return 'Sofas';
  if (/headboard|\bbed\b|beds\/|bedroom\/beds/.test(haystack)) return 'Beds';
  // "Lounge" / occasional / living-room armchairs land here.
  if (/lounge.chair|lounge-chair|armchair|tub.chair|wing.chair|occasional.chair|living\/chairs/.test(haystack)) {
    return 'Lounge Chairs';
  }
  // Bare "chair" not in dining / lounge taxonomy → generic Chairs.
  if (/\bchair\b/.test(haystack)) return 'Chairs';

  return null;
}

// Substitutes the BigCommerce `{:size}` placeholder with the hi-res
// width. URLs that don't carry the placeholder (rare) are returned
// unchanged.
function hiResUrl(template) {
  if (typeof template !== 'string') return null;
  return template.replace('{:size}', HI_RES_WIDTH);
}

// Coerces a price value out of BigCommerce's nested price object.
// Prefers sale_price_with_tax (what the user actually pays), falls
// back to non_sale_price_with_tax, then plain with_tax. Returns null
// on missing.
function priceFromBc(p) {
  const sale = p?.price?.sale_price_with_tax?.value;
  if (Number.isFinite(Number(sale)) && Number(sale) > 0) return Number(sale);
  const list = p?.price?.non_sale_price_with_tax?.value;
  if (Number.isFinite(Number(list)) && Number(list) > 0) return Number(list);
  const plain = p?.price?.with_tax?.value;
  if (Number.isFinite(Number(plain)) && Number(plain) > 0) return Number(plain);
  return null;
}

// Extracts the current-variant selection (the single colour & size
// the product page is rendering) from the options[] axes. Returns
// { colour, size } with nulls for anything missing.
function variantFromOptions(p) {
  const out = { colour: null, size: null };
  for (const opt of p?.options ?? []) {
    const selected = (opt.values ?? []).find((v) => v?.selected) ?? (opt.values ?? [])[0];
    if (!selected) continue;
    const display = (opt.display_name ?? '').toLowerCase();
    if (display.includes('colour') || display.includes('material') || display.includes('color')) {
      out.colour = selected.label ?? null;
    } else if (display.includes('size') || display.includes('seat') || display.includes('configuration')) {
      out.size = selected.label ?? null;
    }
  }
  return out;
}

function decodeHtmlEntities(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function slugFromUrl(url) {
  const last = url.split('/').pop().replace(/\.html.*$/i, '');
  return last.slice(0, 80);
}

// Pull a structured "W: x mm x D: y mm x H: z mm" dimensions string
// out of the product description (Coco embeds dimensions inline in
// the description body for most products).
function extractDimensions(description) {
  if (typeof description !== 'string') return null;
  const pick = (re) => {
    const r = description.match(re);
    if (!r) return null;
    const n = Number(r[1]);
    if (!Number.isFinite(n)) return null;
    const lower = description.toLowerCase();
    return lower.includes('mm') ? Math.round(n / 10) : n;
  };
  return {
    width_cm: pick(/W[: ]*(\d+(?:\.\d+)?)/i),
    depth_cm: pick(/D[: ]*(\d+(?:\.\d+)?)/i),
    height_cm: pick(/H[: ]*(\d+(?:\.\d+)?)/i),
  };
}

export async function scrapeCocoRepublic() {
  console.log(`[${RETAILER}] starting`);
  const outDir = retailerOutputDir(RETAILER_SLUG);
  const errors = [];

  const all = await listProductUrls();
  console.log(`[${RETAILER}] ${all.length} total products in sitemap`);

  const heroUrls = all.filter((u) => HERO_INCLUDE.test(u) && !HERO_EXCLUDE.test(u));
  console.log(`[${RETAILER}] ${heroUrls.length} hero-category urls after URL pre-filter`);

  const targetUrls = heroUrls.slice(0, TARGET_MAX);

  const products = [];
  for (let i = 0; i < targetUrls.length; i++) {
    const url = targetUrls[i];
    try {
      if (!(await isAllowed(url))) {
        console.warn(`[${RETAILER}] skip (robots): ${url}`);
        continue;
      }
      const html = await fetchText(url);
      const ctx = extractBcJsContext(html);
      if (!ctx?.product) {
        errors.push({ url, error: 'no bcJsContext.product' });
        continue;
      }
      const p = ctx.product;

      // Category gate — anything not in the target set is filtered
      // here (silently — avoid noisy log per-product).
      const category = categoryFromCoco(p);
      if (!category || !TARGET_CATEGORIES.has(category)) continue;

      const slug = slugFromUrl(url);
      const description = decodeHtmlEntities(p.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || null;
      const price = priceFromBc(p);
      const variant = variantFromOptions(p);
      const dimensions = extractDimensions(p.description ?? '');
      const sku = p.sku ?? null;

      // Image extraction. Each entry in p.images has a `data` field
      // with the `{:size}` placeholder. We substitute hi-res width
      // and dedupe by source URL.
      const sources = [];
      const seen = new Set();
      for (const img of p.images ?? []) {
        const src = hiResUrl(img?.data);
        if (!src || seen.has(src)) continue;
        seen.add(src);
        sources.push(src);
        if (sources.length >= MAX_IMAGES_PER_PRODUCT) break;
      }

      // Download in source order. We keep going on individual image
      // failures — partial image coverage is better than dropping the
      // whole product.
      const localPaths = [];
      for (let imgIdx = 0; imgIdx < sources.length; imgIdx++) {
        const src = sources[imgIdx];
        try {
          const dl = await downloadImage({
            url: src,
            retailerDir: outDir,
            slug,
            index: imgIdx,
            resize: false,
          });
          localPaths.push(dl.localPath);
          await delay(400);
        } catch (err) {
          errors.push({ url: src, error: String(err?.message ?? err), productUrl: url });
        }
      }

      const hero = localPaths[0] ?? null;

      products.push({
        id: slug,
        retailer: RETAILER,
        name: decodeHtmlEntities(p.name ?? '') || slug,
        category,
        price,
        currency: 'AUD',
        dimensions,
        images: {
          hero,
          downloaded: hero != null,
          source: sources[0] ?? null,
          all: localPaths,
          // `all_sources` carries the per-image source URLs in the
          // same order as `all`. The ingest step reads this into the
          // new products.image_urls[] column. Existing scrapers don't
          // populate it; ingest tolerates the missing field by
          // falling back to a single-element array.
          all_sources: sources,
        },
        product_url: url,
        description: description?.slice(0, 600) ?? null,
        sku,
        variant,
        market_segment: segmentFor(RETAILER),
        scraped_at: new Date().toISOString(),
      });

      if ((i + 1) % 10 === 0) {
        console.log(`[${RETAILER}] ${i + 1}/${targetUrls.length} processed · ${products.length} kept`);
      }
    } catch (err) {
      errors.push({ url, error: String(err?.message ?? err) });
    }
    await delay();
  }

  await writeJson(path.join(outDir, 'products.json'), products);
  if (errors.length > 0) {
    await writeJson(path.join(outDir, 'errors.json'), errors);
  }
  console.log(`[${RETAILER}] wrote ${products.length} products, ${errors.length} errors`);
  return { retailer: RETAILER, products, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCocoRepublic()
    .then(({ products, errors }) => {
      console.log(`done — ${products.length} products, ${errors.length} errors`);
    })
    .catch((err) => {
      console.error('coco republic scrape failed', err);
      process.exit(1);
    });
}
