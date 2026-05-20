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

// IP-Adapter weights on HuggingFace. Round-6 eval used XLabs-AI/
// flux-ip-adapter with the openai/clip-vit-large-patch14 encoder —
// palette adherence stayed at 3/10 and the render's walls stayed
// white + bed went sage-green, suggesting the IP-Adapter never
// actually engaged (fal probably accepts the field but silently
// can't find the underspecified XLabs weights without a `weight_name`).
//
// Round 7 switches to InstantX/FLUX.1-dev-IP-Adapter — it's better
// documented: weights live at `ip-adapter.bin` in the repo root,
// trained against google/siglip-so400m-patch14-384 (SigLIP, not
// CLIP). InstantX's docs name every artefact explicitly so fal has
// nothing to guess.
const IP_ADAPTER_PATH = 'InstantX/FLUX.1-dev-IP-Adapter';
const IP_ADAPTER_WEIGHT_NAME = 'ip-adapter.bin';
const IP_ADAPTER_ENCODER = 'google/siglip-so400m-patch14-384';

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

// fal-ai/client throws errors whose meaningful detail lives in
// non-standard fields (`.status`, `.body`, `.url`) rather than
// `.message` — which is often empty. Round-7 eval saw the catch
// blocks log "reason: " with nothing after, because we were only
// reading `.message`. This extractor pulls every useful field so
// we can finally see fal's actual rejection reason.
export function describeFalError(err: unknown): string {
  if (err == null) return '(no error)';
  if (typeof err === 'string') return err;
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (e.message) parts.push(`message="${String(e.message).slice(0, 300)}"`);
  if (e.status != null) parts.push(`status=${e.status}`);
  if (e.statusText) parts.push(`statusText="${String(e.statusText).slice(0, 80)}"`);
  if (e.body) {
    try {
      parts.push(`body=${JSON.stringify(e.body).slice(0, 1200)}`);
    } catch {
      parts.push(`body=${String(e.body).slice(0, 1200)}`);
    }
  }
  if (e.url) parts.push(`url=${String(e.url).slice(0, 200)}`);
  if (parts.length === 0) {
    // Last resort: full JSON dump if .message + .body + everything is empty.
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 800);
    } catch {
      return String(err);
    }
  }
  return parts.join(' · ');
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
          weight_name: IP_ADAPTER_WEIGHT_NAME,
          image_encoder_path: IP_ADAPTER_ENCODER,
          // Round 6 used 0.4 → no visible effect (likely the adapter
          // didn't load at all). Round 7 bumps to 0.7 — if InstantX
          // loads properly we should see a clear pull toward palette
          // colours. If even 0.7 has no effect, the input shape itself
          // is being silently rejected by fal and we need a different
          // diagnostic path (fal logs or a test call).
          scale: 0.7,
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
    // Canny structure preservation. Round-8 eval surfaced fal's
    // actual schema:
    //   - control_method_url   = the control LoRA to use ('canny' is
    //                            a built-in alias; fal also accepts
    //                            'depth', 'hedsketch', 'pose', etc.
    //                            or a safetensors URL)
    //   - image_control_type   = HOW the control conditions Flux —
    //                            'spatial' (structural — what canny IS)
    //                            or 'subject' (style/identity, like IP-Adapter)
    //                            REQUIRED — fal returned 422 without it
    //   - scale                = control weight (was `conditioning_scale`
    //                            in my round-7 code — silently ignored
    //                            by fal, which then used default 1.0)
    easycontrols: [
      {
        image_url: input.controlImageUrl,
        control_method_url: 'canny',
        image_control_type: 'spatial',
        scale: 0.65,
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
  const payload = renderInput(input);
  const ipa = (payload as { ip_adapters?: Array<Record<string, unknown>> }).ip_adapters?.[0];
  if (ipa) {
    console.log(
      `[fal] ip_adapters[0]: path=${String(ipa.path)} weight_name=${String(ipa.weight_name)} ` +
        `encoder=${String(ipa.image_encoder_path)} scale=${String(ipa.scale)} ` +
        `image_url=${String(ipa.image_url).slice(0, 60)}...`,
    );
  } else {
    console.log('[fal] ip_adapters: not provided');
  }

  // Try the full payload (with IP-Adapter if configured). If fal
  // rejects it — round 7 eval found that the InstantX IP-Adapter
  // config consistently 4xx'd, killing the eval entirely with no
  // render — fall back to a text-only payload so we at least get a
  // baseline render out. The error is logged loudly so we can debug
  // the IP-Adapter rejection separately without it blocking everything.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submit = (p: unknown) => client.queue.submit(ENDPOINT, { input: p as any });

  try {
    const submission = await submit(payload);
    return { requestId: submission.request_id };
  } catch (err) {
    console.error(`[fal] submit failed → ${describeFalError(err)}`);
    if (ipa) {
      console.warn('[fal] retrying without IP-Adapter (text-only fallback)');
      const textOnlyPayload = renderInput({ ...input, paletteSwatchUrl: null });
      try {
        const submission = await submit(textOnlyPayload);
        return { requestId: submission.request_id };
      } catch (err2) {
        console.error(`[fal] text-only fallback ALSO failed → ${describeFalError(err2)}`);
        throw err2;
      }
    }
    throw err;
  }
}

export type RenderStatus = 'in_queue' | 'in_progress' | 'completed' | 'failed';

export interface RenderStatusInfo {
  status: RenderStatus;
  logs?: string[];
}

export async function checkRenderStatus(requestId: string): Promise<RenderStatusInfo> {
  const client = getFal();
  try {
    // logs: true — when fal reports `failed`, the only way to see why
    // (couldn't load IP-Adapter weights, encoder mismatch, OOM, etc.)
    // is via the queue logs. Round 7 eval found that pollFal was
    // getting back a bare "failed" string with no diagnostic — fixed
    // here by requesting logs and surfacing them in the failure case.
    const res = await client.queue.status(ENDPOINT, { requestId, logs: true });
    const raw = (res as { status?: string }).status ?? 'IN_QUEUE';
    const lower = String(raw).toLowerCase();
    // Extract logs if present — shape is { logs: [{ message, level, ... }] }.
    const logEntries = (res as { logs?: Array<{ message?: string }> }).logs ?? [];
    const logs = logEntries
      .map((e) => (typeof e?.message === 'string' ? e.message : ''))
      .filter(Boolean);
    if (lower === 'completed') return { status: 'completed', logs };
    if (lower === 'in_progress') return { status: 'in_progress', logs };
    if (lower === 'in_queue') return { status: 'in_queue', logs };
    return { status: 'failed', logs };
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
