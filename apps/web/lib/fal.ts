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

// IP-Adapter weights on HuggingFace. Round-7 used InstantX/FLUX.1-
// dev-IP-Adapter which failed in production with:
//   "Could not load pipeline due to error: The size of tensor a (32)
//    must match the size of tensor b (1056) at non-singleton dim 1"
// Diagnosis (per InstantX HF README): "The code has not been
// integrated into diffusers yet" — InstantX uses 128 image tokens
// + bespoke MLPProjModel + custom forward inserts into 38 single +
// 19 double blocks. fal's flux-general endpoint wraps diffusers'
// load_ip_adapter() which can't drive InstantX's custom pipeline.
// The tensor mismatch is the diffusers loader trying to wire
// projection layers it doesn't understand.
//
// Round 12: switch to XLabs-AI/flux-ip-adapter — confirmed working
// via diffusers PR #10717 (the PR that added FluxImg2ImgPipeline
// IP-Adapter support, exactly the fal-general code path). Uses
// .safetensors (not .bin) + CLIP-L/14 (not SigLIP). Fal explicitly
// recognises XLabs v1 — their schema notes that use_real_cfg should
// be on for XLabs v1.
const IP_ADAPTER_PATH = 'XLabs-AI/flux-ip-adapter';
const IP_ADAPTER_WEIGHT_NAME = 'ip_adapter.safetensors';
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
//   Round 5-7  — eval was silently failing because canny
//                easycontrol payload was malformed and fal silently
//                used canny scale=1.0 → over-locked or rejected entirely
//   Round 8 @ canny 0.65, strength 0.82, IP-Adapter        → 5.2/10
//                FIRST round with IP-Adapter actually engaging:
//                palette adherence 2→7, surfaces 2→7. BUT geometry
//                cratered 7→3 (canny 0.65 too loose) and hallucinations
//                2 (sliding door / timber floor / new bedhead).
//   Round 9 @ canny 0.80, strength 0.78                   → 4.5/10
//                Two-knob change was greedy — geometry recovered
//                (3→6) and hallucinations recovered (2→5) but
//                surface transformation crashed (7→3) and palette
//                adherence dropped (7→4). Walls went back to white.
//                Strength 0.78 was too tight for the palette to
//                land on walls.
//   Round 10 (current) — keep canny 0.80 (geometry lever), REVERT
//                strength to 0.82 (palette/surface lever). One-knob
//                change isolates the strength effect. Target: hold
//                R9's geometry/hallucinations while recovering R8's
//                palette/surface — ~5.5-6.0 with all criteria ≥4.
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
          // Round 11 bumps 0.7 → 0.9. Rounds 8-10 showed IP-Adapter
          // lands palette on soft furnishings (bedding, pillows,
          // curtains) but not walls — canny preservation of wall
          // edges dominates the colour fill. Higher IP-Adapter scale
          // gives the palette conditioning more authority across
          // every pixel, including geometrically-constrained ones
          // like walls. Risk: too much pressure can flatten the
          // render toward the swatch's stripe geometry, but at 0.9
          // we're still well under the "obvious overlay" threshold.
          scale: 0.9,
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
    // Required for XLabs v1 IP-Adapter per fal's flux-general schema
    // note: "If using XLabs IP-Adapter v1, this will be turned on!"
    // Only meaningful when ip_adapters is present; harmless otherwise.
    use_real_cfg: Boolean(input.paletteSwatchUrl),
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
        // Round 9 bump 0.65 → 0.80 to re-lock the original window/
        // floor/bedhead geometry against the round-8 hallucinations
        // (sliding-door + courtyard, timber floor patch, rectangular
        // bedhead replacement). IP-Adapter scale stays at 0.7 — it's
        // doing the palette job correctly so don't disturb.
        scale: 0.80,
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

// --- Alternative provider: fal-ai/flux-pro/kontext/multi ---------------
//
// Kontext takes multiple images directly as natural inputs — no canny
// ControlNet, no IP-Adapter plumbing, no path/encoder/weight_name
// configuration nightmares. We pass [roomPhoto, paletteSwatch] as
// image_urls and a natural-language prompt that names each image's
// role. The model reasons about both images together.
//
// Why this is a sensible A/B vs flux-general:
//   - Eliminates the entire IP-Adapter failure class (tensor mismatch,
//     pipeline-load errors, encoder mismatches)
//   - Multi-reference compositional editing is what Kontext was
//     designed for — our use case is literally that
//   - Same fal SDK, same polling, same Supabase URL flow
//   - $0.04/img, 6-12s — parity or better than flux-general
//
// Trade-off: geometry preservation is CONTEXTUAL (model understands
// "preserve architecture" from the prompt) rather than CANNY-LOCKED
// (mathematical edge preservation). May drift on pixel-rigid details
// but might also free up surface colour to actually transform.
const KONTEXT_ENDPOINT = 'fal-ai/flux-pro/kontext/multi';

export interface KontextRenderInput {
  prompt: string;
  // Image 1 — the room to restyle (structure-source).
  controlImageUrl: string;
  // Image 2 — the palette swatch (style-source). Required for Kontext
  // — there's no point using this endpoint without a reference.
  paletteSwatchUrl: string;
  // Images 3+ — optional product reference images (#173). When the
  // matcher's hero products have catalogue image URLs we upload them
  // to fal storage and pass here so Kontext renders the scene WITH
  // those specific pieces baked in, skipping the post-render Sharp
  // composite pipeline entirely. Cap at 4 to keep prompt + payload
  // manageable; flux-pro/kontext/multi accepts arbitrary array
  // lengths but quality degrades past 5-6 refs.
  productImageUrls?: string[];
  // Optional aspect_ratio override (e.g. '4:3', '16:9'). When omitted
  // Kontext picks based on the input images.
  aspectRatio?: string;
}

function kontextRenderInput(input: KontextRenderInput) {
  const products = (input.productImageUrls ?? []).slice(0, 4);
  return {
    prompt: input.prompt,
    image_urls: [input.controlImageUrl, input.paletteSwatchUrl, ...products],
    // Bumped from default 3.5 → 4.5 to give prompt directives more
    // authority. We're now relying on the prompt for both palette
    // application AND structural preservation (no canny). Without
    // higher guidance, Kontext drifts into style-adjacent
    // reinterpretation (cottage windows, parquet floors, etc.).
    guidance_scale: 4.5,
    num_images: 1,
    output_format: 'jpeg' as const,
    safety_tolerance: '2' as const,
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
  };
}

export async function submitKontextRender(input: KontextRenderInput): Promise<SubmitRenderResult> {
  const client = getFal();
  console.log(
    `[fal-kontext] submitting: prompt=${input.prompt.slice(0, 80)}... ` +
      `image_urls=[room, palette${(input.productImageUrls ?? []).length > 0 ? `, +${(input.productImageUrls ?? []).slice(0, 4).length} products` : ''}]`,
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const submission = await client.queue.submit(KONTEXT_ENDPOINT, {
      input: kontextRenderInput(input) as any,
    });
    return { requestId: submission.request_id };
  } catch (err) {
    console.error(`[fal-kontext] submit failed → ${describeFalError(err)}`);
    throw err;
  }
}

export async function checkKontextStatus(requestId: string): Promise<RenderStatusInfo> {
  const client = getFal();
  try {
    const res = await client.queue.status(KONTEXT_ENDPOINT, { requestId, logs: true });
    const raw = (res as { status?: string }).status ?? 'IN_QUEUE';
    const lower = String(raw).toLowerCase();
    const logEntries = (res as { logs?: Array<{ message?: string }> }).logs ?? [];
    const logs = logEntries
      .map((e) => (typeof e?.message === 'string' ? e.message : ''))
      .filter(Boolean);
    if (lower === 'completed') return { status: 'completed', logs };
    if (lower === 'in_progress') return { status: 'in_progress', logs };
    if (lower === 'in_queue') return { status: 'in_queue', logs };
    return { status: 'failed', logs };
  } catch (err) {
    console.error('fal-kontext queue.status failed', err);
    return { status: 'failed' };
  }
}

export async function fetchKontextResult(requestId: string): Promise<DepthRenderOutput> {
  const client = getFal();
  const res = await client.queue.result(KONTEXT_ENDPOINT, { requestId });
  const data = res.data as { images?: Array<{ url: string }>; seed?: number };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal-kontext returned no image');
  return { imageUrl: url, seed: data.seed ?? 0 };
}

// --- Provider dispatch -------------------------------------------------
//
// Env-gated provider switching so /api/render, the status route, and
// the eval pipeline can all swap between flux-general (canny + maybe
// IP-Adapter) and kontext-multi (multi-image natural-language editor)
// from a single FLUX_PROVIDER env var.
//
// Default: kontext-multi. Round 14 eval (5.0/10 avg, all six criteria
// ≥4) was the first config across 15 iterations to break the 5.0
// ceiling — and Kontext eliminates the IP-Adapter failure class that
// killed every flux-general production render. Production now uses
// Kontext by default. Set FLUX_PROVIDER=flux-general to roll back.

export type FluxProvider = 'flux-general' | 'kontext-multi' | 'openai-image-1';

export function getActiveProvider(): FluxProvider {
  const raw = (process.env.FLUX_PROVIDER ?? 'kontext-multi').toLowerCase();
  if (raw === 'flux-general') return 'flux-general';
  if (raw === 'kontext' || raw === 'kontext-multi') return 'kontext-multi';
  // #176 — gpt-image-1 path. Pivot after Flux Kontext multi-image
  // produced collage outputs on product reference input. Opt-in via
  // FLUX_PROVIDER=openai-image-1; requires OPENAI_API_KEY.
  if (raw === 'openai' || raw === 'openai-image-1' || raw === 'gpt-image-1') {
    return 'openai-image-1';
  }
  return 'kontext-multi';
}

// Provider-aware status check. Production status route calls this so
// the same env var that controls submit also controls poll.
export async function checkActiveStatus(requestId: string): Promise<RenderStatusInfo> {
  return getActiveProvider() === 'kontext-multi'
    ? checkKontextStatus(requestId)
    : checkRenderStatus(requestId);
}

export async function fetchActiveResult(requestId: string): Promise<DepthRenderOutput> {
  return getActiveProvider() === 'kontext-multi'
    ? fetchKontextResult(requestId)
    : fetchRenderResult(requestId);
}
