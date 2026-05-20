import { fal } from '@fal-ai/client';
import { getServerEnv } from '@/lib/env';

// Pivot endpoint (2026-05-20). The single-conditioning canny endpoint
// (`fal-ai/flux-control-lora-canny/image-to-image`) couldn't break
// palette adherence past 4/10 across 5 prompt-engineering eval rounds —
// Flux's text vocab for paint names is too loose to deliver pixel-exact
// hex matching. `fal-ai/flux-general/image-to-image` is the same Flux
// dev model but exposes the underlying pipeline, so we can stack:
//   * init image (room photo)              → image_url
//   * canny structure preservation         → easycontrols[0]
//   * palette swatch visual conditioning   → ip_adapters[0]  ← the new lever
// All in one call. The legacy endpoint stays referenced below as
// LEGACY_ENDPOINT for the /api/warm warmup ping only.
const ENDPOINT = 'fal-ai/flux-general/image-to-image';
const LEGACY_ENDPOINT = 'fal-ai/flux-control-lora-canny/image-to-image';

// IP-Adapter weights on HuggingFace. XLabs' Flux IP-Adapter is the most
// widely-used + battle-tested adapter for Flux dev. The image encoder
// is the standard CLIP ViT-L/14 that XLabs trained against.
const IP_ADAPTER_PATH = 'XLabs-AI/flux-ip-adapter';
const IP_ADAPTER_ENCODER = 'openai/clip-vit-large-patch14';

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
  // canny edge source (the easycontrol derives canny from it internally).
  controlImageUrl: string;
  // Optional palette swatch reference image — a 512x512 PNG with the
  // palette's 5 role colours as horizontal stripes. When provided,
  // Flux conditions on the visual palette via IP-Adapter in addition
  // to the text prompt. See lib/paletteSwatch.ts.
  paletteSwatchUrl?: string | null;
  width?: number;
  height?: number;
  // Optional denoise strength override. Defaults to 0.82 — slightly
  // looser than the round-4 0.85 to give surfaces freedom to actually
  // change colour now that IP-Adapter is providing the palette anchor.
  strength?: number;
}

export interface DepthRenderOutput {
  imageUrl: string;
  seed: number;
}

// Upload a PNG buffer to fal storage. Returns a public URL that fal
// endpoints can fetch from. Used to host the per-render palette swatch
// image so we can pass it as the IP-Adapter reference.
export async function uploadImageBuffer(
  buf: Buffer,
  filename = 'image.png',
  contentType = 'image/png',
): Promise<string> {
  const client = getFal();
  const blob = new Blob([new Uint8Array(buf)], { type: contentType });
  const file = new File([blob], filename, { type: contentType });
  return client.storage.upload(file);
}

// Render config. Tuned via repeat Claude Sonnet vision eval runs
// (2026-05-19/20).
//   Round 1 @ strength 0.87, canny 0.65, guidance 4.0     → 4.7/10
//   Round 2 @ strength 0.80 + CRITICAL ceiling            → 3.3 (collapsed)
//   Round 3 @ strength 0.85 + named tokens                → 4.5 (recovered)
//   Round 4 @ canny 0.75 + extended NO list               → 4.0 (regressed)
//   Round 5 (current) @ canny 0.65, strength 0.82,
//          + IP-Adapter palette swatch                    → testing now
// Palette adherence specifically stuck at 2-4 across all 5 text-only
// rounds — only visual conditioning addresses the root cause.
function renderInput(input: DepthRenderInput) {
  // flux-general's typed input is strict; the @fal-ai/client schema
  // expects a specific shape. We construct the full object including
  // the optional ip_adapters array conditionally, then cast as the
  // expected input type at the submit call site.
  const ipAdapters = input.paletteSwatchUrl
    ? [
        {
          image_url: input.paletteSwatchUrl,
          path: IP_ADAPTER_PATH,
          image_encoder_path: IP_ADAPTER_ENCODER,
          // 0.4 = balanced. Higher (0.6+) starts to flatten the render
          // toward the swatch geometry. Lower (0.2) doesn't move the
          // needle. Tune from eval feedback.
          scale: 0.4,
        },
      ]
    : undefined;
  return {
    prompt: input.prompt,
    image_url: input.controlImageUrl,
    strength: input.strength ?? 0.82,
    image_size: input.width && input.height
      ? { width: input.width, height: input.height }
      : ('landscape_4_3' as const),
    num_inference_steps: 20,
    guidance_scale: 5.0,
    num_images: 1,
    enable_safety_checker: true,
    // Canny structure preservation — same role as the legacy endpoint's
    // control_lora_image_url at strength 0.65. easycontrols[] is the
    // flux-general shortcut: fal preprocesses canny from the image, we
    // just set the method + scale.
    easycontrols: [
      {
        image_url: input.controlImageUrl,
        control_method_url: 'canny',
        conditioning_scale: 0.65,
      },
    ],
    ...(ipAdapters ? { ip_adapters: ipAdapters } : {}),
  };
}

// Blocking render — used by warmup endpoint with a 1-step ping image.
// Stays on the LEGACY endpoint because the warmup ping doesn't need
// IP-Adapter and the legacy endpoint is the well-understood path for
// warm-cache pings.
export async function renderWithDepth(input: DepthRenderInput): Promise<DepthRenderOutput> {
  const client = getFal();
  const legacyInput = {
    prompt: input.prompt,
    image_url: input.controlImageUrl,
    control_lora_image_url: input.controlImageUrl,
    strength: input.strength ?? 0.82,
    control_lora_strength: 0.65,
    image_size: input.width && input.height
      ? { width: input.width, height: input.height }
      : ('landscape_4_3' as const),
    num_inference_steps: 20,
    guidance_scale: 5.0,
    num_images: 1,
    enable_safety_checker: true,
  };
  const result = await client.subscribe(LEGACY_ENDPOINT, { input: legacyInput, logs: false });
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
  // Cast the input through `any` — fal-ai/client's generated types
  // produce a discriminated-union of every endpoint's input schema and
  // can't narrow to flux-general from the runtime string ENDPOINT.
  // The fal-side validates the actual shape so this is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submission = await client.queue.submit(ENDPOINT, { input: renderInput(input) as any });
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
