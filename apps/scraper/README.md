# myhome scraper — internal demo only

A proof-of-concept scraper that collects product data from Australian furniture
retailers so we can build a pitch demo of the **myhome** product-rendering
flow with real SKUs.

> **Internal use only.** Scraped data is not published, redistributed, or shown
> to anyone outside of internal demos. All output will be replaced with
> official retailer product feeds before any commercial launch.

## What it does

For each supported retailer, the scraper writes:

- `output/<retailer>/products.json` — array of product records in the myhome
  schema (id, name, category, price, dimensions, images, product_url,
  description, scraped_at)
- `output/<retailer>/images/<slug>-<n>.jpg` — hero images, resized to 1200px
  wide, JPEG quality 85
- `output/<retailer>/errors.json` — anything that failed, for review

## Retailers

| Retailer | Status | Platform | Notes |
|---|---|---|---|
| Poliform Australia | ✅ Implemented | Shopify | Uses public `products.json` endpoint — no headless browser needed |
| Coco Republic | ⏳ Stub | BigCommerce | Needs Playwright; not built yet |
| GlobeWest | ⏳ Stub | Custom (trade) | Needs Playwright; price often gated |

## Setup

From the repo root:

```bash
pnpm install
```

Playwright is listed as a dependency for the future Coco/GlobeWest scrapers,
but Poliform doesn't need it. If you want to install the Chromium binary now:

```bash
pnpm --filter @myhome/scraper exec playwright install chromium
```

## Run

From the repo root:

```bash
# Run only Poliform (the working one)
pnpm --filter @myhome/scraper scrape:poliform

# Run all three (Coco + GlobeWest will print "not implemented" until built)
pnpm --filter @myhome/scraper scrape
```

Or from inside `apps/scraper/`:

```bash
pnpm scrape:poliform
```

## Output

After a successful run you'll see something like:

```
=== Poliform ===
[Poliform] starting
[Poliform] fetching page 1
[Poliform] 64 candidate products after filtering
[Poliform] wrote 64 products (target met)

=== Summary ===
  ✓ Poliform: 64 products, 62 images, 0 errors
  – Coco Republic: 0 products, 0 images, 0 errors
  – GlobeWest: 0 products, 0 images, 0 errors
Output written to ./output/  (took 47.3s)
```

## Scraping rules (non-negotiable)

The scraper enforces:

- **2.5s+ delay** between requests with random jitter (configurable via
  `REQUEST_DELAY_MS` env var, never below 2000)
- **robots.txt respected** — every request is checked first; disallowed paths
  are skipped with a warning
- **Identifying user-agent**:
  `myhome-demo-bot/1.0 (concept demo; contact hello@myhome.com)` (overridable
  via `USER_AGENT` env var)
- **Public catalogue only** — no login walls, no personalised endpoints
- **One request at a time** — scrapers run sequentially, never in parallel
- **50–100 products per retailer** — hero categories only (sofas, dining,
  beds, chairs)

## Legal note

This scraper is for internal concept validation only. Data collected is **not
published or redistributed**. All scraped content will be replaced with
official retailer product feeds upon commercial agreement (Commission Factory
/ Impact / direct feeds).

## Next steps

Once a retailer commercial conversation lands a feed:

1. Disable the matching scraper (set its `run` to a no-op in `scrapers/index.js`)
2. Add an ingestion job for the official feed (CSV/XML) that writes to the
   same `output/<retailer>/products.json` shape so the rest of the pipeline
   doesn't change
