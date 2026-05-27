// ComfyUI API client — talks to the owner's Mac via the cloudflared
// tunnel. Powers Mode C (ControlNet-grade room preservation).
//
// API surface this hits (all on the ComfyUI HTTP server, exposed
// through https://<tunnel>.trycloudflare.com):
//   POST /upload/image        multipart  — upload a source image to
//                                          ComfyUI's input/ folder
//   POST /prompt              json       — submit a workflow; returns
//                                          a prompt_id
//   GET  /history/<prompt_id> json       — poll for completion; when
//                                          done, contains `outputs`
//                                          keyed by node ID with the
//                                          output filenames
//   GET  /view?filename&subfolder&type   — fetch the rendered PNG
//
// Stage 1 ships the client + a smoke-test route (/api/comfyui-smoketest);
// no production code path calls renderViaComfyUI yet. Stage 2 layers
// Depth ControlNet onto the workflow builder. Stage 3 wires this into
// /api/render as Mode C.
//
// Auth: there is none today. The trycloudflare URL is the security
// token (4 random words, unguessable). Before this is the production
// render path, add a shared-secret header (COMFYUI_AUTH_TOKEN) that
// Vercel sets and a small reverse proxy on the Mac validates before
// forwarding to localhost:8188. See docs/COMFYUI-SETUP.md §Hardening.

import { randomUUID } from 'node:crypto';
import {
  buildImg2ImgWorkflow,
  buildModeCDepthWorkflow,
  type ComfyUIWorkflow,
} from './comfyui-workflows';

function getComfyUIUrl(): string {
  const url = process.env.COMFYUI_URL;
  if (!url) {
    throw new Error(
      'COMFYUI_URL is not set. Set it to the cloudflared tunnel URL pointing at your local ComfyUI (e.g. https://<words>.trycloudflare.com). See docs/COMFYUI-SETUP.md.',
    );
  }
  return url.replace(/\/+$/, '');
}

/** Bound every fetch to ComfyUI so a hung Mac never wedges a Vercel
 *  function. Polling fetches use a shorter window; the upload + submit
 *  use the default. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a fetch in retry-with-backoff. Network-layer errors (DNS,
 *  connection refused, socket reset) get retried; HTTP errors (4xx/5xx)
 *  bubble up to the caller for normal handling.
 *
 *  Used by pollHistory + fetchComfyUIOutput because long-running renders
 *  on the owner's Mac sometimes coincide with transient DNS hiccups
 *  (especially when the Mac's network interface flips between Wi-Fi
 *  and LTE). The Stage 1 smoke test was killed by exactly one DNS
 *  drop mid-poll on 2026-05-27 — a single retry would have absorbed
 *  it.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number; backoffMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 1_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, init, opts.timeoutMs);
    } catch (err) {
      lastError = err;
      // Don't retry if the caller's AbortController aborted us.
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetch retry exhausted: ${String(lastError)}`);
}

export interface UploadImageResult {
  /** The filename ComfyUI assigned. Usually the one we sent, possibly
   *  suffixed with `(1)` etc. if a clash existed and `overwrite` was 0. */
  name: string;
  /** Subfolder inside ComfyUI/input/. Empty string for root. */
  subfolder: string;
  /** Always 'input' for /upload/image. */
  type: string;
}

/** Upload an image to ComfyUI's input folder. Subsequent workflow
 *  submissions reference it via the returned `name`. */
export async function uploadImageToComfyUI(
  buf: Buffer,
  filename: string,
): Promise<UploadImageResult> {
  const url = getComfyUIUrl();
  const form = new FormData();
  // overwrite=1 so retries with the same filename don't pile up; each
  // submission already uses a unique timestamped name, but defensive
  // in case the caller reuses one.
  form.append('image', new Blob([new Uint8Array(buf)]), filename);
  form.append('type', 'input');
  form.append('overwrite', '1');

  const res = await fetchWithTimeout(`${url}/upload/image`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `ComfyUI /upload/image failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as UploadImageResult;
}

interface SubmitPromptResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

/** Submit a workflow to ComfyUI's queue. Returns the prompt_id we then
 *  poll for completion. Throws on node validation errors so the caller
 *  sees them surfaced (rather than waiting until poll timeout). */
export async function submitWorkflow(workflow: ComfyUIWorkflow): Promise<string> {
  const url = getComfyUIUrl();
  // client_id is what ComfyUI uses to scope websocket events to a
  // single client. We're polling REST, not subscribing to ws, so the
  // value just needs to be unique-per-submission to avoid cache
  // collisions on ComfyUI's side.
  const clientId = `mymaison-${randomUUID()}`;

  const res = await fetchWithTimeout(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `ComfyUI /prompt failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as SubmitPromptResponse;
  if (data.node_errors && Object.keys(data.node_errors).length > 0) {
    throw new Error(
      `ComfyUI rejected workflow with node_errors: ${JSON.stringify(data.node_errors).slice(0, 600)}`,
    );
  }
  if (!data.prompt_id) {
    throw new Error(`ComfyUI returned no prompt_id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.prompt_id;
}

interface HistoryOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

interface HistoryStatusMessage {
  /** Tuple-style log row, e.g. ["execution_error", { exception_message: ... }]. */
  0?: string;
  1?: Record<string, unknown>;
}

interface HistoryEntry {
  prompt: unknown;
  outputs: Record<string, { images?: HistoryOutputImage[] } | undefined>;
  status?: {
    status_str?: 'success' | 'error' | string;
    completed?: boolean;
    messages?: HistoryStatusMessage[];
  };
}

/** Thrown when ComfyUI marks the prompt as errored. Carries the
 *  surfaced traceback / messages so callers can log them. */
export class ComfyUIExecutionError extends Error {
  readonly promptId: string;
  readonly messages: HistoryStatusMessage[];
  constructor(promptId: string, messages: HistoryStatusMessage[]) {
    const summary = describeComfyUIErrorMessages(messages);
    super(`ComfyUI execution error for prompt ${promptId}: ${summary}`);
    this.name = 'ComfyUIExecutionError';
    this.promptId = promptId;
    this.messages = messages;
  }
}

function describeComfyUIErrorMessages(messages: HistoryStatusMessage[] | undefined): string {
  if (!messages || messages.length === 0) return '(no error messages in history entry)';
  const parts: string[] = [];
  for (const m of messages) {
    const kind = String(m?.[0] ?? '');
    const detail = m?.[1] ?? {};
    if (kind === 'execution_error') {
      const node = detail.node_id ?? detail.node_type ?? '?';
      const exType = detail.exception_type ?? 'Exception';
      const exMsg = String(detail.exception_message ?? '').slice(0, 300);
      parts.push(`[node ${node}] ${exType}: ${exMsg}`);
    } else if (kind === 'execution_interrupted') {
      parts.push('execution interrupted');
    } else if (kind) {
      // Capture unknown message kinds verbatim so we never silently
      // swallow an error type we haven't seen before.
      parts.push(`${kind}: ${JSON.stringify(detail).slice(0, 200)}`);
    }
  }
  return parts.join(' | ');
}

/** Poll ComfyUI /history/<prompt_id> until the prompt's outputs land.
 *  ComfyUI returns an empty object until the worker picks the job up;
 *  once running, the entry appears with `status.completed === true`
 *  and `outputs` populated.
 *
 *  Throws ComfyUIExecutionError if ComfyUI reports `status_str === 'error'`
 *  so the caller doesn't poll forever on a failed job. This was the
 *  Stage 1 smoke-test bug — polls kept ticking on a job that errored
 *  in 0.45s, burning 30+ minutes of "rendering" output before someone
 *  killed it manually.
 *
 *  Network errors during the poll (DNS hiccup, transient connection
 *  reset) are absorbed by fetchWithRetry — long polls survive single
 *  network dropouts without the caller noticing. */
export async function pollHistory(
  promptId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<HistoryEntry> {
  const url = getComfyUIUrl();
  // SDXL on M2 Max is ~70s warm, 3-5min cold (MPS kernel compile).
  // 5 min covers cold start; ControlNet workflows extend the warm
  // case to ~120s but cold start ceiling doesn't shift much. Override
  // via opts.timeoutMs for Stage 3 multi-pass inpainting workflows
  // which can hit 5-7 minutes per render on M2 Max.
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    let res: Response;
    try {
      res = await fetchWithRetry(
        `${url}/history/${encodeURIComponent(promptId)}`,
        { method: 'GET' },
        { timeoutMs: 15_000, retries: 3, backoffMs: 1_000 },
      );
    } catch {
      // Even after retry, the network is still down. Give it the
      // poll interval and try again next loop — the render may still
      // be progressing locally on the Mac.
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry?.status) {
        if (entry.status.status_str === 'error') {
          throw new ComfyUIExecutionError(promptId, entry.status.messages ?? []);
        }
        if (entry.status.completed === true) {
          return entry;
        }
      }
    }
    // 404 is normal before the worker picks the job up — keep polling.
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `ComfyUI render timed out after ${timeoutMs}ms (prompt_id=${promptId}). The Mac may be asleep, the tunnel may be down, or the workflow is hung.`,
  );
}

/** Pull the rendered PNG out of ComfyUI's /view endpoint. Uses
 *  fetchWithRetry so a single network blip after a 5-minute render
 *  doesn't force us to redo the render — the image is sitting on the
 *  Mac and we just need one healthy moment to grab it. */
export async function fetchComfyUIOutput(image: HistoryOutputImage): Promise<Buffer> {
  const url = getComfyUIUrl();
  const qs = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const res = await fetchWithRetry(
    `${url}/view?${qs.toString()}`,
    { method: 'GET' },
    { timeoutMs: 60_000, retries: 3, backoffMs: 1_000 },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `ComfyUI /view failed for ${image.filename}: ${res.status} — ${body.slice(0, 200)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export interface RenderViaComfyUIInput {
  roomBuf: Buffer;
  /** File extension/mime hint for the uploaded room photo. ComfyUI is
   *  permissive but the filename extension affects how Pillow decodes. */
  filename?: string;
  positivePrompt: string;
  negativePrompt?: string;
  denoise?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  /** Override the ImageScale max long-side dimension. The 32GB M2 Max
   *  smoketest on 2026-05-27 OOM'd at 1024 with --cpu-vae; 512 cleared.
   *  Production setups with proper GPUs can leave this default. */
  maxLongSide?: number;
}

export interface RenderViaComfyUIResult {
  outputBuf: Buffer;
  /** ms from upload to output fetch — useful for cost-perf logging. */
  durationMs: number;
  promptId: string;
}

export interface RenderViaComfyUIWithDepthInput extends RenderViaComfyUIInput {
  /** ControlNet strength 0..1. Default 1.0 (full geometric lock). */
  controlnetStrength?: number;
  /** ControlNet weights filename. Defaults to the SDXL depth model
   *  per docs/COMFYUI-SETUP.md. */
  controlnetName?: string;
}

/** Internal helper — uploads the room photo, submits any workflow,
 *  polls, fetches the first output image. The two public functions
 *  (renderViaComfyUI + renderViaComfyUIWithDepth) only differ in
 *  which workflow they build. */
async function executeRender(
  roomBuf: Buffer,
  filenameHint: string | undefined,
  buildWorkflow: (uploadedName: string) => ComfyUIWorkflow,
  pollTimeoutMs: number,
): Promise<RenderViaComfyUIResult> {
  const start = Date.now();
  // Timestamped + random-suffixed so concurrent renders never collide
  // on ComfyUI's input folder.
  const filename =
    filenameHint ?? `mymaison-input-${Date.now()}-${randomUUID().slice(0, 8)}.png`;

  const uploaded = await uploadImageToComfyUI(roomBuf, filename);
  const workflow = buildWorkflow(uploaded.name);
  const promptId = await submitWorkflow(workflow);
  const entry = await pollHistory(promptId, { timeoutMs: pollTimeoutMs });

  // Find the first output image across all nodes that produced one.
  // For Stage 1 / 2 this is node "8" (SaveImage); we don't hardcode
  // that ID so future workflows with re-numbered SaveImage nodes still
  // work.
  const outputImages: HistoryOutputImage[] = Object.values(entry.outputs ?? {})
    .flatMap((node) => node?.images ?? [])
    .filter((img): img is HistoryOutputImage => Boolean(img));
  const first = outputImages[0];
  if (!first) {
    throw new Error(
      `ComfyUI completed prompt ${promptId} but produced no output images. Outputs: ${JSON.stringify(entry.outputs).slice(0, 300)}`,
    );
  }

  const outputBuf = await fetchComfyUIOutput(first);
  return { outputBuf, durationMs: Date.now() - start, promptId };
}

/** Stage 1 baseline: SDXL img2img through ComfyUI. No ControlNet, no
 *  product conditioning. Used by the smoke-test route to validate the
 *  wire-up. Not the production Mode C path — see
 *  renderViaComfyUIWithDepth + (future) renderViaComfyUIModeC. */
export async function renderViaComfyUI(
  input: RenderViaComfyUIInput,
): Promise<RenderViaComfyUIResult> {
  return executeRender(
    input.roomBuf,
    input.filename,
    (uploadedName) =>
      buildImg2ImgWorkflow({
        inputImageFilename: uploadedName,
        positivePrompt: input.positivePrompt,
        negativePrompt: input.negativePrompt,
        denoise: input.denoise,
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        maxLongSide: input.maxLongSide,
        filenamePrefix: 'myMaison_smoketest',
      }),
    5 * 60_000,
  );
}

/** Stage 2 Mode C path: SDXL img2img + Depth ControlNet. The depth
 *  map (auto-derived from the input photo via MiDaS) locks the room's
 *  geometry — walls, floor, ceiling, large furniture silhouettes — so
 *  the denoise step can re-style surfaces without inventing new
 *  windows or moving walls. This is the failure mode that the Mode A
 *  (gpt-image-1) path keeps hitting and that Mode C exists to fix.
 *
 *  Pre-reqs on the ComfyUI side:
 *    - SDXL base checkpoint (sd_xl_base_1.0.safetensors)
 *    - SDXL Depth ControlNet (control_v11p_sdxl_depth.safetensors)
 *    - comfyui_controlnet_aux custom node installed (MiDaS preprocessor
 *      auto-downloads its weights on first use)
 *
 *  Stage 3 (next PR) layers per-product inpainting onto this — for
 *  each picked product from the curation step, mask the region of the
 *  piece it replaces and inpaint with the product's cutout PNG as
 *  visual conditioning. Multi-pass = 4-6 passes per render. This
 *  function is the foundation those passes will composite onto. */
export async function renderViaComfyUIWithDepth(
  input: RenderViaComfyUIWithDepthInput,
): Promise<RenderViaComfyUIResult> {
  return executeRender(
    input.roomBuf,
    input.filename,
    (uploadedName) =>
      buildModeCDepthWorkflow({
        inputImageFilename: uploadedName,
        positivePrompt: input.positivePrompt,
        negativePrompt: input.negativePrompt,
        denoise: input.denoise,
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        maxLongSide: input.maxLongSide,
        controlnetName: input.controlnetName,
        controlnetStrength: input.controlnetStrength,
        filenamePrefix: 'myMaison_modeC_depth',
      }),
    // Depth ControlNet adds the preprocessor + controlnet apply
    // overhead. On M2 Max the first call also has to download MiDaS
    // weights (~1.3GB). Bump to 8 min total to cover cold start.
    8 * 60_000,
  );
}

export interface SubmitModeCWithDepthInput
  extends Omit<RenderViaComfyUIWithDepthInput, 'roomBuf' | 'filename'> {
  roomBuf: Buffer;
  filename?: string;
}

export interface SubmitModeCResult {
  /** ComfyUI prompt_id. Stored on renders.comfyui_prompt_id; the
   *  status route uses this to poll /history/{prompt_id}. */
  promptId: string;
  /** The filename ComfyUI assigned to the uploaded input image.
   *  Mostly for debugging; the status route doesn't need it. */
  inputFilename: string;
}

/** Submit-only variant of renderViaComfyUIWithDepth — uploads the
 *  room photo + submits the workflow, then returns the prompt_id
 *  immediately. Does NOT poll for completion or fetch the output.
 *
 *  Used by /api/render's Mode C branch (PR #77 async refactor) so
 *  the route stays inside Vercel's 60s function budget. The status
 *  route (/api/renders/[id]/status) drives the prompt to completion
 *  by polling /history/{prompt_id} and fetching the output when
 *  done. Same architecture pattern as fal-ai/kontext-multi's
 *  fal_request_id flow.
 *
 *  Upload + submit together take ~2-5s on a healthy tunnel
 *  (depending on image size). Well within Vercel's budget. */
export async function submitModeCWithDepth(
  input: SubmitModeCWithDepthInput,
): Promise<SubmitModeCResult> {
  const filename =
    input.filename ?? `mymaison-input-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  const uploaded = await uploadImageToComfyUI(input.roomBuf, filename);
  const workflow = buildModeCDepthWorkflow({
    inputImageFilename: uploaded.name,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt,
    denoise: input.denoise,
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    maxLongSide: input.maxLongSide,
    controlnetName: input.controlnetName,
    controlnetStrength: input.controlnetStrength,
    filenamePrefix: 'myMaison_modeC_depth',
  });
  const promptId = await submitWorkflow(workflow);
  return { promptId, inputFilename: uploaded.name };
}

/** Single-shot status probe for a previously-submitted Mode C
 *  prompt. Hits /history/{prompt_id} ONCE and returns immediately
 *  with one of:
 *    - 'queued' / 'running' — caller's polling loop should keep
 *       polling (e.g. status route returns status='running' to the
 *       client and waits for the next /status request).
 *    - 'success' — caller can call fetchComfyUIOutput() on the
 *       returned image descriptor to grab the bytes.
 *    - 'error' — ComfyUI reported a node-execution failure; the
 *       returned messages describe what went wrong.
 *
 *  Designed for the status route's polling pattern — fast (~1s
 *  round-trip through tunnel), non-blocking, called once per
 *  client poll. Distinct from pollHistory() which loops internally
 *  for renderViaComfyUI*'s synchronous orchestration path. */
export type ModeCPollResult =
  | { status: 'queued' | 'running' }
  | { status: 'success'; image: HistoryOutputImage }
  | { status: 'error'; messages: HistoryStatusMessage[]; summary: string };

export async function checkModeCPromptStatus(
  promptId: string,
): Promise<ModeCPollResult> {
  const url = getComfyUIUrl();
  const res = await fetchWithRetry(
    `${url}/history/${encodeURIComponent(promptId)}`,
    { method: 'GET' },
    { timeoutMs: 15_000, retries: 2, backoffMs: 1_000 },
  );
  if (!res.ok) {
    // 404 happens when the prompt is queued but not yet running.
    // Treat as still-running so the client keeps polling.
    return { status: 'queued' };
  }
  const data = (await res.json()) as Record<string, HistoryEntry>;
  const entry = data[promptId];
  if (!entry || !entry.status) return { status: 'queued' };
  if (entry.status.status_str === 'error') {
    return {
      status: 'error',
      messages: entry.status.messages ?? [],
      summary: describeComfyUIErrorMessages(entry.status.messages),
    };
  }
  if (entry.status.completed === true) {
    const outputImages = Object.values(entry.outputs ?? {})
      .flatMap((node) => node?.images ?? [])
      .filter((img): img is HistoryOutputImage => Boolean(img));
    const first = outputImages[0];
    if (!first) {
      // Marked completed but no images — treat as error so the row
      // gets flagged failed rather than spinning forever.
      return {
        status: 'error',
        messages: [],
        summary: 'ComfyUI marked prompt complete but returned no output images',
      };
    }
    return { status: 'success', image: first };
  }
  return { status: 'running' };
}
