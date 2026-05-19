import { fal } from '@fal-ai/client';
import { getServerEnv } from '@/lib/env';

const ENDPOINT = 'fal-ai/flux-control-lora-canny/image-to-image';

let configured = false;

export function getFal() {
  if (!configured) {
    const { FAL_KEY } = getServerEnv();
    if (!FAL_KEY) {
      throw new Error('FAL_KEY is not set. Add it to apps/web/.env.local.');
    }
    fal.config({ credentials: FAL_KEY });
    configured = true;
  }
  return fal;
}

export interface DepthRenderInput {
  prompt: string;
  // The original room photo. Used both as the img2img init image AND as the
  // depth-control source (the endpoint derives depth from it internally).
  controlImageUrl: string;
  width?: number;
  height?: number;
  // Optional denoise strength override. Defaults to 0.82 (bold mode — walls
  // and floor allowed to transform). Set to 0.70 for subtle mode (legacy
  // architecture-preserving behaviour). See lib/styles.ts → PromptMode.
  strength?: number;
}

export interface DepthRenderOutput {
  imageUrl: string;
  seed: number;
}

// Architecture-preserving restyle. We use Flux dev's img2img variant with
// canny edge ControlNet LoRA. For interiors, canny outperforms depth because
// walls, window frames, door frames and floor boundaries are STRONG EDGES
// that canny locks directly. Depth smooths over those edges into gradients,
// which lets the model "improve" architecture (extra windows, shifted walls
// — see brief gotcha #2).
//
//   - image_url             — original room photo, init image for img2img
//   - control_lora_image_url — same photo, canny edges are derived from it
//   - strength              — denoise level (0 = identical, 1 = re-generate).
//                              0.55 keeps the room recognisable while still
//                              letting surfaces + furniture restyle.
//   - control_lora_strength — canny lock strength. 0.85 is firm without
//                              freezing texture details.
function renderInput(input: DepthRenderInput) {
  return {
    prompt: input.prompt,
    image_url: input.controlImageUrl,
    control_lora_image_url: input.controlImageUrl,
    // Aggressive default — Flux is encouraged to repaint walls, swap
    // flooring, drape windows, add statement lighting. The two knobs:
    //   - strength (img2img): how much Flux can deviate from the init
    //     image. 0.87 is firm but still recognisable; 0.90+ starts
    //     hallucinating extra windows.
    //   - control_lora_strength (canny): how strictly the canny LoRA
    //     enforces existing edges. 0.85 locked surface textures too
    //     hard (no repaint of walls or floors). 0.55 was too loose —
    //     window content drifted (upstairs view became ground-floor
    //     with a fence) and Flux invented ceiling vents that weren't
    //     in the source. 0.65 anchors architectural detail (ceiling,
    //     window frames, fixtures) while still letting Flux repaint
    //     wall surfaces and flooring freely.
    strength: input.strength ?? 0.87,
    control_lora_strength: 0.65,
    image_size: input.width && input.height
      ? { width: input.width, height: input.height }
      : ('landscape_4_3' as const),
    // 20 steps is the sweet spot for Flux dev — visible quality starts to
    // drop below ~15 and the marginal improvement above 20 isn't worth the
    // extra ~8s of inference time for interior renders.
    num_inference_steps: 20,
    // 4.0 — push Flux to obey the palette + surface directives. Above 5
    // it starts oversaturating and the editorial feel collapses.
    guidance_scale: 4.0,
    num_images: 1,
    enable_safety_checker: true,
  };
}

// Blocking render — used by warmup endpoint with a 1-step ping image. Avoid
// for real renders; use submitDepthRender instead so we don't hit Vercel's
// 60s serverless timeout while Flux runs.
export async function renderWithDepth(input: DepthRenderInput): Promise<DepthRenderOutput> {
  const client = getFal();
  const result = await client.subscribe(ENDPOINT, { input: renderInput(input), logs: false });
  const data = result.data as { images?: Array<{ url: string }>; seed?: number };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal.ai returned no image');
  return { imageUrl: url, seed: data.seed ?? 0 };
}

// --- Async / queue-based pipeline -----------------------------------------
//
// Submit the job and return a request id; we poll status later from the
// /api/renders/[id]/status endpoint. This avoids tying a single Vercel
// function call to the full ~30s Flux run, which would overrun the 60s
// Hobby-plan timeout.

export interface SubmitRenderResult {
  requestId: string;
}

export async function submitDepthRender(input: DepthRenderInput): Promise<SubmitRenderResult> {
  const client = getFal();
  const submission = await client.queue.submit(ENDPOINT, { input: renderInput(input) });
  return { requestId: submission.request_id };
}

export type RenderStatus = 'in_queue' | 'in_progress' | 'completed' | 'failed';

export interface RenderStatusInfo {
  status: RenderStatus;
  logs?: string[];
}

export async function checkRenderStatus(requestId: string): Promise<RenderStatusInfo> {
  const client = getFal();
  try {
    const res = await client.queue.status(ENDPOINT, { requestId, logs: false });
    const raw = (res as { status?: string }).status ?? 'IN_QUEUE';
    const lower = String(raw).toLowerCase();
    if (lower === 'completed') return { status: 'completed' };
    if (lower === 'in_progress') return { status: 'in_progress' };
    if (lower === 'in_queue') return { status: 'in_queue' };
    return { status: 'failed' };
  } catch (err) {
    // 4xx from fal usually means the job no longer exists (cleared after TTL).
    // Treat as failed so the caller can recover.
    console.error('fal.queue.status failed', err);
    return { status: 'failed' };
  }
}

export async function fetchRenderResult(requestId: string): Promise<DepthRenderOutput> {
  const client = getFal();
  const res = await client.queue.result(ENDPOINT, { requestId });
  const data = res.data as { images?: Array<{ url: string }>; seed?: number };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal.ai returned no image');
  return { imageUrl: url, seed: data.seed ?? 0 };
}
