// Fire-and-forget warmup endpoint. Called from /rooms/new on mount so that
// by the time the user submits their photo:
//   1. fal.ai's Florence-2 endpoint is hot (saves ~5-15s of cold-start)
//   2. fal.ai's Flux ControlNet endpoint has the worker ready
//   3. Our local CLIP model is loaded into memory (saves ~5-10s on first call)
//
// We don't actually run a full inference here — we ping with a tiny payload
// that returns quickly. The model warm-up happens on the fal side as a
// side-effect of accepting the request.

import { NextResponse } from 'next/server';
import { warmEmbeddings } from '@/lib/embeddings';
import { getFal } from '@/lib/fal';

export const runtime = 'nodejs';
export const maxDuration = 30;

// A tiny 1x1 transparent PNG so fal accepts the request and spins up its worker.
const TINY_PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function POST() {
  // All warm-ups run in parallel and we deliberately swallow any errors —
  // a failed warm-up shouldn't break the upload page.
  await Promise.allSettled([
    warmEmbeddings(),
    pingFal('fal-ai/florence-2-large/object-detection', { image_url: TINY_PNG_URL }),
    pingFal('fal-ai/flux-control-lora-canny/image-to-image', {
      prompt: 'warmup',
      image_url: TINY_PNG_URL,
      control_lora_image_url: TINY_PNG_URL,
      strength: 0.5,
      num_inference_steps: 1,
      image_size: { width: 64, height: 64 },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

async function pingFal(endpoint: string, input: Record<string, unknown>) {
  try {
    const client = getFal();
    // We don't await full completion — just queue the job so the worker spins.
    // 8s timeout in case fal hangs.
    await Promise.race([
      client.queue.submit(endpoint, { input }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('warm timeout')), 8000)),
    ]);
  } catch {
    // expected — we don't care about the response
  }
}
