// Generate trend hero cards for the dashboard. For each (palette, room_type)
// combination we want, we:
//   1. Build a Flux prompt from the palette colours + room type
//   2. Call fal-ai/flux/dev to render a hero image (~25s each)
//   3. Call Claude to write a 2-sentence designer note
//   4. Save the image to the trends bucket + insert/update the trend_cards row
//
// Re-runnable: upserts by (palette_id, room_type). Skip combinations that
// already exist unless --refresh is passed.

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fal } from '@fal-ai/client';
import Anthropic from '@anthropic-ai/sdk';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FAL_KEY = process.env.FAL_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !FAL_KEY || !ANTHROPIC_KEY) {
  console.error(
    'Missing env. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FAL_KEY, ANTHROPIC_API_KEY in apps/scraper/.env',
  );
  process.exit(1);
}

const refresh = process.argv.includes('--refresh');

fal.config({ credentials: FAL_KEY });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Load palettes from the same JSON the web app uses.
const palettesPath = path.resolve('..', 'web', 'lib', 'palettes.json');
const palettesFile = JSON.parse(await readFile(palettesPath, 'utf-8'));
const palettes = palettesFile.palettes;

// Curated combinations — one row of the dashboard's TRENDS FOR YOU strip.
// Each combo says: this palette shines in this room type.
const COMBOS = [
  { paletteId: 'warm-grounded-earth', roomType: 'living_room' },
  { paletteId: 'transformative-teal', roomType: 'bathroom' },
  { paletteId: 'misty-blue-neutral', roomType: 'bedroom' },
  { paletteId: 'mossy-green-ochre', roomType: 'kitchen' },
  { paletteId: 'warm-mahogany-clay', roomType: 'dining_room' },
  { paletteId: 'silhouette-and-pale', roomType: 'library' },
  { paletteId: 'honest-essentials', roomType: 'open_plan' },
  { paletteId: 'pale-mint-sea-breeze', roomType: 'bedroom' },
  { paletteId: 'pistachio-chocolate', roomType: 'kitchen' },
];

function buildPrompt(palette, roomType) {
  const wall = palette.room_roles.wall;
  const sofa = palette.room_roles.sofa;
  const floor = palette.room_roles.floor;
  const accent = palette.room_roles.accent;
  const room = roomType.replace(/_/g, ' ');
  return [
    `editorial interior photograph of a ${room}`,
    `${palette.name.toLowerCase()} palette`,
    `walls in ${wall.name.toLowerCase()}`,
    `floor in ${floor.name.toLowerCase()}`,
    `key upholstery in ${sofa.name.toLowerCase()}`,
    `${accent.name.toLowerCase()} accents`,
    palette.style_tags.slice(0, 2).join(' '),
    'natural daylight, soft shadows',
    '35mm lens, photorealistic, architectural digest editorial',
    'Australian residential, considered styling, AIDA finalist quality',
  ].join(', ');
}

async function generateImage(palette, roomType) {
  const prompt = buildPrompt(palette, roomType);
  const res = await fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt,
      image_size: 'landscape_4_3',
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    },
    logs: false,
  });
  const url = res.data?.images?.[0]?.url;
  if (!url) throw new Error('fal returned no image');
  return url;
}

async function generateNote(palette, roomType) {
  const room = roomType.replace(/_/g, ' ');
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    temperature: 0.7,
    system:
      "You write punchy 1–2 sentence design notes for an AU interior trend card. Be specific and confident, no fluff, never start with 'discover' or 'experience'. Reference the palette by name. Aim for 40–60 words total. Plain text only, no markdown.",
    messages: [
      {
        role: 'user',
        content: `Palette: ${palette.name} — ${palette.vibe}. Trend source: ${palette.trend_source}. Materials it loves: ${palette.pairs_with_materials.join(', ')}. Room: ${room}. Why a senior AU designer would use this combo in this room — 1–2 sentences.`,
      },
    ],
  });
  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join(' ')
    .trim();
  return text;
}

async function generateHeadline(palette, roomType) {
  const room = roomType.replace(/_/g, ' ');
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    temperature: 0.7,
    system:
      'You write 3-5 word headlines for interior trend cards. Title case, no punctuation. Examples: "Warm Earth Living", "Quiet Teal Bathroom", "Mossy Green Kitchen". Plain text only, no quotes.',
    messages: [
      {
        role: 'user',
        content: `Palette: ${palette.name}. Room: ${room}. Vibe: ${palette.vibe}.`,
      },
    ],
  });
  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join(' ')
    .trim()
    .replace(/^["']|["']$/g, '');
  return text;
}

async function uploadImage(url, key) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const { error } = await supabase.storage.from('trends').upload(key, bytes, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

let made = 0;
let skipped = 0;
const errors = [];

for (const combo of COMBOS) {
  const palette = palettes.find((p) => p.id === combo.paletteId);
  if (!palette) {
    errors.push({ combo, error: 'palette not found' });
    continue;
  }

  // Skip if already done unless --refresh.
  if (!refresh) {
    const { data } = await supabase
      .from('trend_cards')
      .select('id')
      .eq('palette_id', combo.paletteId)
      .eq('room_type', combo.roomType)
      .maybeSingle();
    if (data) {
      console.log(`skip ${combo.paletteId} / ${combo.roomType} (exists)`);
      skipped++;
      continue;
    }
  }

  try {
    console.log(`generating ${combo.paletteId} / ${combo.roomType}…`);
    const [imageUrl, headline, description] = await Promise.all([
      generateImage(palette, combo.roomType),
      generateHeadline(palette, combo.roomType),
      generateNote(palette, combo.roomType),
    ]);
    const key = `${combo.paletteId}__${combo.roomType}.webp`;
    await uploadImage(imageUrl, key);

    const row = {
      palette_id: combo.paletteId,
      palette_name: palette.name,
      room_type: combo.roomType,
      headline,
      description,
      image_storage_key: key,
      source_signal: palette.trend_source,
    };
    const { error } = await supabase
      .from('trend_cards')
      .upsert(row, { onConflict: 'palette_id,room_type' });
    if (error) {
      errors.push({ combo, error: error.message });
      console.error('  upsert failed:', error.message);
    } else {
      console.log(`  ✓ ${headline}`);
      made++;
    }
  } catch (err) {
    errors.push({ combo, error: String(err?.message ?? err) });
    console.error(`  ✗ ${combo.paletteId}/${combo.roomType}: ${err}`);
  }
}

console.log('\n=== Summary ===');
console.log(`  generated: ${made}`);
console.log(`  skipped:   ${skipped}`);
console.log(`  errors:    ${errors.length}`);
if (errors.length > 0) {
  await writeFile('./trend-errors.json', JSON.stringify(errors, null, 2));
  console.log('  wrote trend-errors.json');
}
