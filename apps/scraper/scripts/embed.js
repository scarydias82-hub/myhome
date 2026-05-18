// Generate CLIP image embeddings for every product in Supabase and store them
// on products.embedding (vector(512)). Run once after ingestion, and re-run
// whenever new products are added.
//
// We use @huggingface/transformers (transformers.js) so embeddings run locally
// on Node — no API calls, no per-product cost. The CLIP ViT-Base-Patch32 model
// downloads once (~150 MB) into ~/.cache and is reused.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@huggingface/transformers';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}

const MODEL = 'Xenova/clip-vit-base-patch32';
const BATCH = 25; // rows fetched per page from Supabase

console.log(`Loading CLIP model ${MODEL}…`);
const model = await CLIPVisionModelWithProjection.from_pretrained(MODEL);
const processor = await AutoProcessor.from_pretrained(MODEL);
console.log('Model ready.');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embedUrl(url) {
  const img = await RawImage.fromURL(url);
  const inputs = await processor(img);
  const out = await model(inputs);
  return out.image_embeds.tolist()[0];
}

const startedAt = Date.now();
let processed = 0;
let updated = 0;
let skipped = 0;
const errors = [];

// Page through products that don't yet have an embedding.
for (;;) {
  const { data, error } = await supabase
    .from('products')
    .select('id, image_url, name')
    .is('embedding', null)
    .limit(BATCH);
  if (error) {
    console.error('supabase select failed', error);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    processed++;
    if (!row.image_url) {
      skipped++;
      continue;
    }
    try {
      const vec = await embedUrl(row.image_url);
      const { error: updateErr } = await supabase
        .from('products')
        .update({ embedding: vec })
        .eq('id', row.id);
      if (updateErr) {
        errors.push({ id: row.id, error: updateErr.message });
      } else {
        updated++;
        if (updated % 10 === 0) {
          const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`  ${updated} embedded (${secs}s)`);
        }
      }
    } catch (err) {
      errors.push({ id: row.id, name: row.name, error: String(err?.message ?? err) });
    }
  }
}

const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('\n=== Summary ===');
console.log(`  scanned:  ${processed}`);
console.log(`  updated:  ${updated}`);
console.log(`  skipped:  ${skipped}`);
console.log(`  errors:   ${errors.length}`);
console.log(`  runtime:  ${secs}s`);
if (errors.length > 0) {
  console.log('\nFirst 5 errors:');
  for (const e of errors.slice(0, 5)) {
    console.log(`  ${e.id}${e.name ? ` (${e.name})` : ''}: ${e.error}`);
  }
}
