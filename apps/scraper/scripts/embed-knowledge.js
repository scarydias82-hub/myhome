// Embed the curated design-knowledge seed JSON into the design_knowledge
// table. Uses CLIP's TEXT encoder — same 512-dim projection as the image
// encoder we use for products, so the two embedding spaces are comparable.
//
// Re-runnable: upserts by (source, chunk_index). Safe to run after editing
// the seed file.

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { CLIPTextModelWithProjection, AutoTokenizer } from '@huggingface/transformers';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/scraper/.env');
  process.exit(1);
}

const MODEL = 'Xenova/clip-vit-base-patch32';
const SEED_PATH = path.resolve('data', 'design-knowledge-seed.json');

console.log(`Loading CLIP text encoder ${MODEL}…`);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL);
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
console.log('Text encoder ready.');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const seed = JSON.parse(await readFile(SEED_PATH, 'utf-8'));
console.log(`Seed file: ${seed.entries.length} entries.`);

// CLIP's text encoder has a 77-token context window. Most chunks fit; for
// longer ones we naively truncate at the tokenizer step (it auto-handles it).
async function embedText(text) {
  const inputs = tokenizer([text], { padding: true, truncation: true });
  const out = await model(inputs);
  return out.text_embeds.tolist()[0];
}

let processed = 0;
let updated = 0;
const errors = [];

for (let i = 0; i < seed.entries.length; i++) {
  const e = seed.entries[i];
  processed++;
  try {
    const vec = await embedText(`${e.title ?? ''}\n${e.chunk_text}`);
    const row = {
      source: e.source,
      source_url: e.source_url ?? null,
      title: e.title ?? null,
      chunk_text: e.chunk_text,
      chunk_index: i,
      tags: e.tags ?? [],
      embedding: vec,
      published_at: e.published_at ?? null,
    };
    const { error } = await supabase
      .from('design_knowledge')
      .upsert(row, { onConflict: 'source,chunk_index' });
    if (error) {
      errors.push({ source: e.source, error: error.message });
      console.error(`  ✗ ${e.source}: ${error.message}`);
    } else {
      updated++;
    }
    if (updated > 0 && updated % 5 === 0) console.log(`  ${updated} embedded`);
  } catch (err) {
    errors.push({ source: e.source, error: String(err?.message ?? err) });
    console.error(`  ✗ ${e.source}:`, err);
  }
}

console.log('\n=== Summary ===');
console.log(`  scanned:  ${processed}`);
console.log(`  upserted: ${updated}`);
console.log(`  errors:   ${errors.length}`);
if (errors.length > 0) {
  console.log('\nErrors:');
  for (const e of errors) console.log(`  ${e.source}: ${e.error}`);
}
