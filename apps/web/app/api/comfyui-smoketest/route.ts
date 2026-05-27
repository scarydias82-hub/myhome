// Mode C smoke-test endpoint.
//
// Purpose: validate the ComfyUI integration (lib/comfyui.ts) end-to-end
// against the live cloudflared tunnel without touching /api/render.
// You upload a room photo + a prompt; the route uploads it to ComfyUI,
// submits an SDXL img2img workflow, polls for completion, and streams
// the rendered PNG back. If anything's wrong with the wire-up (tunnel
// reachability, workflow shape, polling, output fetch) the error
// surfaces here in isolation.
//
// Auth: X-Smoketest-Token header, validated against COMFYUI_TEST_TOKEN.
// Not Supabase-session-gated so it stays one-liner curlable from the
// owner's terminal. The token is the only thing standing between this
// endpoint and burning the owner's Mac GPU on someone else's prompts.
//
// Runtime: intended to be hit from `pnpm --filter web dev` (localhost),
// NOT from Vercel preview/prod — SDXL on M2 Max takes 70-90s per render
// (cold start: 3-5min for MPS kernel compile), well past Vercel's
// hobby 10s / pro 60s function timeouts. maxDuration is set high but
// the realistic test target is local dev.
//
// Curl (Stage 1 baseline — plain img2img):
//   curl -X POST 'http://localhost:3000/api/comfyui-smoketest' \
//     -H 'X-Smoketest-Token: <COMFYUI_TEST_TOKEN>' \
//     -F 'photo=@/path/to/room.jpg' \
//     -F 'prompt=a modern contemporary living room with editorial styling' \
//     -F 'denoise=0.7' \
//     -F 'maxLongSide=512' \
//     --output result.png
//
// Curl (Stage 2 — Depth ControlNet):
//   curl -X POST 'http://localhost:3000/api/comfyui-smoketest' \
//     -H 'X-Smoketest-Token: <COMFYUI_TEST_TOKEN>' \
//     -F 'photo=@/path/to/room.jpg' \
//     -F 'prompt=a modern contemporary living room with editorial styling' \
//     -F 'denoise=0.65' \
//     -F 'maxLongSide=512' \
//     -F 'mode=depth' \
//     --output result-depth.png
//
// `mode=depth` routes through buildModeCDepthWorkflow (Depth ControlNet
// via MiDaS preprocessor). Compare the two outputs A/B — depth should
// preserve walls + furniture silhouettes; plain img2img will drift.
//
// `maxLongSide` defaults to 1024. Set to 512 for 32GB Macs running
// --cpu-vae (the 1024 case OOMs on the Stage 1 smoke test as observed
// on 2026-05-27).
//
// Removed when Mode C is wired into /api/render (Stage 3) and the
// end-to-end path is exercised through the real UI.

import { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { renderViaComfyUI, renderViaComfyUIWithDepth } from '@/lib/comfyui';

export const runtime = 'nodejs';
// Set high for local dev where Vercel timeouts don't apply. On Vercel
// itself this would need fluid-compute or background runners; not the
// intended deployment target for the smoke-test route.
export const maxDuration = 300;

const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12MB cap mirrors /api/analyse-room

function parseFloatField(value: FormDataEntryValue | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function parseIntField(value: FormDataEntryValue | null): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: Request): Promise<Response> {
  const { COMFYUI_URL, COMFYUI_TEST_TOKEN } = getServerEnv();
  if (!COMFYUI_URL) {
    return NextResponse.json(
      { error: 'COMFYUI_URL is not set. See docs/COMFYUI-SETUP.md.' },
      { status: 503 },
    );
  }
  if (!COMFYUI_TEST_TOKEN) {
    return NextResponse.json(
      {
        error:
          'COMFYUI_TEST_TOKEN is not set. Generate any high-entropy string and add it to apps/web/.env.local.',
      },
      { status: 503 },
    );
  }

  const presentedToken = req.headers.get('x-smoketest-token');
  if (presentedToken !== COMFYUI_TEST_TOKEN) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `multipart parse failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const photo = form.get('photo');
  const prompt = form.get('prompt');
  if (!(photo instanceof Blob)) {
    return NextResponse.json(
      { error: 'photo field is required and must be a file upload' },
      { status: 400 },
    );
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt field is required' }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `photo exceeds ${MAX_PHOTO_BYTES} bytes (${photo.size})` },
      { status: 413 },
    );
  }

  const roomBuf = Buffer.from(await photo.arrayBuffer());
  const denoise = parseFloatField(form.get('denoise'), 0.7);
  const seed = parseIntField(form.get('seed'));
  const steps = parseIntField(form.get('steps'));
  const maxLongSide = parseIntField(form.get('maxLongSide'));
  const mode = typeof form.get('mode') === 'string' ? String(form.get('mode')) : 'img2img';
  const controlnetStrength = parseFloatField(form.get('controlnetStrength'), 1.0);

  try {
    const result =
      mode === 'depth'
        ? await renderViaComfyUIWithDepth({
            roomBuf,
            positivePrompt: prompt,
            denoise,
            seed,
            steps,
            maxLongSide,
            controlnetStrength,
          })
        : await renderViaComfyUI({
            roomBuf,
            positivePrompt: prompt,
            denoise,
            seed,
            steps,
            maxLongSide,
          });
    return new Response(new Uint8Array(result.outputBuf), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(result.outputBuf.byteLength),
        // Surface render metadata so curl -i shows it; no auth-sensitive
        // info leaked.
        'X-ComfyUI-Prompt-Id': result.promptId,
        'X-ComfyUI-Duration-Ms': String(result.durationMs),
        'X-ComfyUI-Mode': mode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
