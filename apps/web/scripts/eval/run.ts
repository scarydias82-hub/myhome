// Eval harness CLI. Runs each registered fixture through the full
// render pipeline + Claude vision scorer, writes per-fixture outputs
// and an aggregate Markdown summary into results/<timestamp>/.
//
// Usage:
//   pnpm --filter web exec tsx scripts/eval/run.ts --fixture bedroom-upstairs
//   pnpm --filter web exec tsx scripts/eval/run.ts --all
//   pnpm --filter web exec tsx scripts/eval/run.ts --all --no-score

import { config as loadEnv } from 'dotenv';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// Load env from apps/web/.env.local + .env regardless of CWD.
const __dirname_early = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname_early, '..', '..', '.env.local') });
loadEnv({ path: path.join(__dirname_early, '..', '..', '.env') });

import { FIXTURES, getFixture, type Fixture } from './fixtures';
import { evaluateRender, type Scorecard } from './evaluator';
import { analyseRoom } from '../../lib/vision';
import { getDesignerAdvice } from '../../lib/designer';
import { buildPickingList } from '../../lib/matching';
import { submitDepthRender, checkRenderStatus, fetchRenderResult, uploadImageBuffer } from '../../lib/fal';
import { generatePaletteSwatch } from '../../lib/paletteSwatch';
import { autoFeatureForPalette } from '../../lib/featuring';
import { buildPrompt, getStyle } from '../../lib/styles';
import { getPalette } from '../../lib/palettes';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVAL_USER_ID = process.env.EVAL_USER_ID;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local');
  process.exit(1);
}
if (!EVAL_USER_ID) {
  console.error(
    'Missing EVAL_USER_ID in apps/web/.env.local. Use a manually-provisioned user UUID.',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const __dirname = __dirname_early;
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_ROOT = path.join(__dirname, 'results');

// --- CLI parsing ------------------------------------------------------

const args = process.argv.slice(2);
const fixtureFlag = args.indexOf('--fixture');
const fixtureName = fixtureFlag >= 0 ? args[fixtureFlag + 1] : null;
const all = args.includes('--all');
const noScore = args.includes('--no-score');

let toRun: Fixture[] = [];
if (all) {
  toRun = FIXTURES;
} else if (fixtureName) {
  const f = getFixture(fixtureName);
  if (!f) {
    console.error(`Unknown fixture: ${fixtureName}. Available:`, FIXTURES.map((x) => x.id));
    process.exit(1);
  }
  toRun = [f];
} else {
  console.error('Pass --all or --fixture <id>. See scripts/eval/fixtures.ts.');
  process.exit(1);
}

if (toRun.length === 0) {
  console.error('No fixtures registered. Add some to scripts/eval/fixtures.ts.');
  process.exit(1);
}

// --- run --------------------------------------------------------------

interface IterationResult {
  fixture: Fixture;
  durationMs: number;
  outputs: {
    originalSignedUrl: string;
    renderedFalUrl: string;
    renderedLocalPath: string;
    analysisPath: string;
    designerPath: string;
    pickingListPath: string;
    scorecardPath?: string;
  };
  pickingListSize: number;
  scorecard: Scorecard | null;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(RESULTS_ROOT, stamp);

// Wrapped in async main() because tsx-on-Node-26 transpiles to CJS,
// which doesn't support top-level await. ESM-only Node would allow it,
// but tsx's default target keeps us CJS-compatible.
async function main(): Promise<void> {
  await mkdir(runDir, { recursive: true });

  console.log(`\nEval run → ${runDir}\n`);

  const results: IterationResult[] = [];

  for (const fixture of toRun) {
    console.log(`\n=== ${fixture.id} ===`);
    try {
      const r = await runIteration(fixture);
      results.push(r);
      const dur = ((r.durationMs / 1000) || 0).toFixed(1);
      console.log(`  ✓ ${fixture.id} done in ${dur}s (picking list: ${r.pickingListSize} items)`);
      if (r.scorecard) {
        const s = r.scorecard;
        console.log(
          `    scores: direction ${s.directionMatch.score}, geometry ${s.geometryPreserved.score}, ` +
            `surfaces ${s.surfaceTransformation.score}, hallucinations ${s.hallucinationFreedom.score}, ` +
            `picking-list ${s.pickingListDensity.score}, palette ${s.paletteAdherence.score}`,
        );
      }
    } catch (err) {
      console.error(`  ✗ ${fixture.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  await writeSummary(results, runDir);
  console.log(`\nDone. Summary: ${path.join(runDir, 'summary.md')}\n`);
}

main().catch((err) => {
  console.error('\neval crashed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

// --- iteration --------------------------------------------------------

async function runIteration(fixture: Fixture): Promise<IterationResult> {
  const started = Date.now();
  const out = path.join(runDir, fixture.id);
  await mkdir(out, { recursive: true });

  // 1. Upload the fixture image to the rooms bucket so the rest of
  //    the pipeline can fetch it via signed URLs.
  const localImagePath = path.join(FIXTURES_DIR, fixture.imageFile);
  const imageBytes = await readFile(localImagePath);
  const photoKey = `${EVAL_USER_ID}/_eval/${stamp}-${fixture.id}.jpg`;
  // Re-encode to JPEG just to normalise (HEIC etc.) — at the same
  // ~1600px resize the upload form uses client-side.
  const normalised = await sharp(imageBytes)
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const up = await admin.storage.from('rooms').upload(photoKey, normalised, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  await copyFile(localImagePath, path.join(out, 'original.jpg'));

  const signed = await admin.storage.from('rooms').createSignedUrl(photoKey, 60 * 60);
  const originalSignedUrl = signed.data?.signedUrl;
  if (!originalSignedUrl) throw new Error('could not sign room photo URL');

  // 2. Vision analysis.
  const analysis = await analyseRoom(originalSignedUrl);
  const analysisPath = path.join(out, 'room-analysis.json');
  await writeFile(analysisPath, JSON.stringify(analysis, null, 2));

  // 3. Designer critique.
  const palette = getPalette(fixture.paletteId) ?? null;
  const style = getStyle(fixture.style);
  if (!style) throw new Error(`unknown style: ${fixture.style}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const designer = await getDesignerAdvice({ admin: admin as any, roomAnalysis: analysis, palette });
  const designerPath = path.join(out, 'designer-read.json');
  await writeFile(designerPath, JSON.stringify(designer, null, 2));

  // 4. Build prompt with palette + auto-featured catalogue items
  //    (mirror what /api/render does in production).  Until 2026-05-20
  //    the eval was calling buildPrompt(style, analysis, null) — no
  //    palette param! That meant every "palette adherence" score for
  //    rounds 1-4 was measured against a prompt that didn't mention
  //    the selected palette at all. Production has been passing
  //    palette since round 3; the eval just lagged. Fixed in tandem
  //    with the IP-Adapter pivot.
  const heroProducts = palette
    ? await autoFeatureForPalette({
        admin: admin as unknown as Parameters<typeof autoFeatureForPalette>[0]['admin'],
        paletteId: palette.id,
        roomType: analysis?.room_type ?? null,
        limit: 3,
      })
    : [];
  if (heroProducts.length > 0) {
    console.log(`  auto-featured: ${heroProducts.map((p) => p.name).join(' · ')}`);
  }
  const prompt = buildPrompt(style, analysis, heroProducts.length ? heroProducts : null, palette);
  let paletteSwatchUrl: string | null = null;
  if (palette) {
    try {
      const swatchBuf = await generatePaletteSwatch(palette);
      paletteSwatchUrl = await uploadImageBuffer(swatchBuf, `palette-${palette.id}.png`, 'image/png');
      console.log(`  swatch uploaded: ${paletteSwatchUrl}`);
    } catch (err) {
      console.warn('  swatch upload failed, text-only:', (err as Error).message);
    }
  }
  // 4b. Submit-and-poll with IP-Adapter, retrying text-only if fal's
  //     inference (not just submit) fails. Round 7 found fal ACCEPTING
  //     the InstantX IP-Adapter request but FAILING during inference —
  //     pollFal returned bare "failed" with no diagnostic. Now we surface
  //     fal's logs on failure and retry without IP-Adapter so the eval
  //     always produces a render to score.
  const result = await renderWithIpAdapterFallback({
    prompt,
    controlImageUrl: originalSignedUrl,
    paletteSwatchUrl,
  });

  // 6. Save rendered image locally.
  const renderedBytes = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
  const renderedLocalPath = path.join(out, 'rendered.jpg');
  const renderedJpeg = await sharp(Buffer.from(renderedBytes)).jpeg({ quality: 88 }).toBuffer();
  await writeFile(renderedLocalPath, renderedJpeg);

  // 7. Picking list.
  const paletteHexes = palette?.colors.map((c) => c.hex) ?? style.palette;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picking = await buildPickingList({ admin: admin as any, renderImageUrl: result.imageUrl, paletteHexes });
  const pickingListPath = path.join(out, 'picking-list.json');
  await writeFile(pickingListPath, JSON.stringify(picking, null, 2));

  // 8. Evaluator pass (optional).
  let scorecard: Scorecard | null = null;
  let scorecardPath: string | undefined;
  if (!noScore) {
    try {
      scorecard = await evaluateRender({
        originalImageUrl: originalSignedUrl,
        renderedImageUrl: result.imageUrl,
        designerRead: designer.designerRead || designer.raw.slice(0, 1200),
        styleSlug: fixture.style,
        paletteName: palette?.name ?? style.name,
        pickingListLabels: picking.items.map((i: { itemLabel: string }) => i.itemLabel),
      });
      scorecardPath = path.join(out, 'scorecard.json');
      await writeFile(scorecardPath, JSON.stringify(scorecard, null, 2));
    } catch (err) {
      console.warn(`  scoring failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    fixture,
    durationMs: Date.now() - started,
    outputs: {
      originalSignedUrl,
      renderedFalUrl: result.imageUrl,
      renderedLocalPath,
      analysisPath,
      designerPath,
      pickingListPath,
      scorecardPath,
    },
    pickingListSize: picking.items.length,
    scorecard,
  };
}

// Poll fal queue until completion. ~2s interval, give up at 3 minutes.
// On 'failed' status, surfaces fal's inference logs so we can see why.
async function pollFal(requestId: string): Promise<{ imageUrl: string }> {
  const startedAt = Date.now();
  let lastLogs: string[] = [];
  while (Date.now() - startedAt < 180000) {
    const status = await checkRenderStatus(requestId);
    if (status.logs && status.logs.length) lastLogs = status.logs;
    if (status.status === 'completed') return fetchRenderResult(requestId);
    if (status.status === 'failed') {
      const tail = lastLogs.slice(-20).join('\n  | ');
      throw new Error(`fal reported failed.\nlast logs:\n  | ${tail || '(no logs returned)'}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('fal poll timed out after 3 min');
}

// Submit + poll, retrying text-only if the IP-Adapter version fails
// during inference. Both the submit-side (`submitDepthRender` itself)
// and the inference-side (pollFal throwing on 'failed' status) are
// handled — the latter is what's been silently killing the eval since
// round 7 because fal accepted the InstantX shape at submit but
// couldn't load the weights server-side.
async function renderWithIpAdapterFallback(input: {
  prompt: string;
  controlImageUrl: string;
  paletteSwatchUrl: string | null;
}): Promise<{ imageUrl: string }> {
  const tryOnce = async (paletteSwatchUrl: string | null) => {
    const { requestId } = await submitDepthRender({
      prompt: input.prompt,
      controlImageUrl: input.controlImageUrl,
      paletteSwatchUrl,
    });
    return pollFal(requestId);
  };

  if (!input.paletteSwatchUrl) {
    return tryOnce(null);
  }
  try {
    return await tryOnce(input.paletteSwatchUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  IP-Adapter render failed — retrying text-only.\n  reason: ${msg.slice(0, 600)}`);
    return tryOnce(null);
  }
}

// --- summary writer ---------------------------------------------------

async function writeSummary(results: IterationResult[], dir: string): Promise<void> {
  // raw machine-readable
  const raw = results.map((r) => ({
    fixtureId: r.fixture.id,
    description: r.fixture.description,
    style: r.fixture.style,
    paletteId: r.fixture.paletteId,
    durationMs: r.durationMs,
    pickingListSize: r.pickingListSize,
    scorecard: r.scorecard,
    outputs: r.outputs,
  }));
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(raw, null, 2));

  // aggregate scores
  const scored = results.filter((r) => r.scorecard !== null);
  function avgBlockScore(key: keyof Scorecard): number {
    if (scored.length === 0) return 0;
    let total = 0;
    for (const r of scored) {
      const block = (r.scorecard as Scorecard)[key] as { score?: number };
      total += block?.score ?? 0;
    }
    return total / scored.length;
  }

  const lines: string[] = [];
  lines.push(`# Eval run ${stamp}`);
  lines.push('');
  lines.push(`Fixtures: ${results.length} · Scored: ${scored.length}`);
  lines.push('');
  if (scored.length > 0) {
    lines.push('## Aggregate scores (1-10, higher is better)');
    lines.push('');
    lines.push('| Criterion | Average |');
    lines.push('|-----------|---------|');
    lines.push(`| Direction match | ${avgBlockScore('directionMatch').toFixed(1)} |`);
    lines.push(`| Geometry preserved | ${avgBlockScore('geometryPreserved').toFixed(1)} |`);
    lines.push(`| Surface transformation | ${avgBlockScore('surfaceTransformation').toFixed(1)} |`);
    lines.push(`| Hallucination freedom | ${avgBlockScore('hallucinationFreedom').toFixed(1)} |`);
    lines.push(`| Picking list density | ${avgBlockScore('pickingListDensity').toFixed(1)} |`);
    lines.push(`| Palette adherence | ${avgBlockScore('paletteAdherence').toFixed(1)} |`);
    lines.push('');

    // Common failure patterns + config suggestions
    const allFailures = scored.flatMap((r) => r.scorecard!.topFailureModes);
    const allConfigSuggestions = scored.flatMap((r) => r.scorecard!.configSuggestions);
    if (allFailures.length > 0) {
      lines.push('## Failure modes observed across fixtures');
      lines.push('');
      for (const f of allFailures) lines.push(`- ${f}`);
      lines.push('');
    }
    if (allConfigSuggestions.length > 0) {
      lines.push('## Config suggestions from the evaluator');
      lines.push('');
      for (const c of allConfigSuggestions) lines.push(`- ${c}`);
      lines.push('');
    }
  }

  lines.push('## Per-fixture detail');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.fixture.id}`);
    lines.push('');
    lines.push(`*${r.fixture.description}*`);
    lines.push('');
    lines.push(`Style: \`${r.fixture.style}\` · Palette: \`${r.fixture.paletteId}\` · Duration: ${(r.durationMs / 1000).toFixed(1)}s · Picking list: ${r.pickingListSize} items`);
    lines.push('');
    lines.push(`- Original: \`${r.fixture.id}/original.jpg\``);
    lines.push(`- Rendered: \`${r.fixture.id}/rendered.jpg\``);
    lines.push(`- Picking list: \`${r.fixture.id}/picking-list.json\``);
    lines.push(`- Designer read: \`${r.fixture.id}/designer-read.json\``);
    lines.push('');
    if (r.scorecard) {
      const s = r.scorecard;
      lines.push('| Criterion | Score | Notes |');
      lines.push('|-----------|-------|-------|');
      lines.push(`| Direction match | ${s.directionMatch.score} | ${s.directionMatch.notes} |`);
      lines.push(`| Geometry preserved | ${s.geometryPreserved.score} | ${s.geometryPreserved.notes} |`);
      lines.push(`| Surface transformation | ${s.surfaceTransformation.score} | ${s.surfaceTransformation.notes} |`);
      lines.push(`| Hallucination freedom | ${s.hallucinationFreedom.score} | ${s.hallucinationFreedom.notes} |`);
      lines.push(`| Picking list density | ${s.pickingListDensity.score} | ${s.pickingListDensity.notes} |`);
      lines.push(`| Palette adherence | ${s.paletteAdherence.score} | ${s.paletteAdherence.notes} |`);
      lines.push('');
      lines.push(`**Verdict.** ${s.verdict}`);
      lines.push('');
      if (s.topFailureModes.length > 0) {
        lines.push('Failure modes:');
        for (const f of s.topFailureModes) lines.push(`- ${f}`);
        lines.push('');
      }
    }
  }

  await writeFile(path.join(dir, 'summary.md'), lines.join('\n'));
}
