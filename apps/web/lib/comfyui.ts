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
import { buildImg2ImgWorkflow, type ComfyUIWorkflow } from './comfyui-workflows';

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

interface HistoryEntry {
  prompt: unknown;
  outputs: Record<string, { images?: HistoryOutputImage[] } | undefined>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
}

/** Poll ComfyUI /history/<prompt_id> until the prompt's outputs land.
 *  ComfyUI returns an empty object until the worker picks the job up;
 *  once running, the entry appears with `status.completed === true`
 *  and `outputs` populated. */
export async function pollHistory(
  promptId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<HistoryEntry> {
  const url = getComfyUIUrl();
  // SDXL on M2 Max is ~70s warm, 3-5min cold (MPS kernel compile).
  // 5 min covers cold start; raise for ControlNet workflows.
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetchWithTimeout(
      `${url}/history/${encodeURIComponent(promptId)}`,
      { method: 'GET' },
      15_000,
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry?.status?.completed) {
        return entry;
      }
    }
    // 404 is normal before the worker picks the job up — keep polling.
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `ComfyUI render timed out after ${timeoutMs}ms (prompt_id=${promptId}). The Mac may be asleep, the tunnel may be down, or the workflow is hung.`,
  );
}

/** Pull the rendered PNG out of ComfyUI's /view endpoint. */
export async function fetchComfyUIOutput(image: HistoryOutputImage): Promise<Buffer> {
  const url = getComfyUIUrl();
  const qs = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const res = await fetchWithTimeout(`${url}/view?${qs.toString()}`, { method: 'GET' });
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
}

export interface RenderViaComfyUIResult {
  outputBuf: Buffer;
  /** ms from upload to output fetch — useful for cost-perf logging. */
  durationMs: number;
  promptId: string;
}

/** High-level orchestrator. Upload → submit → poll → fetch.
 *  No production code path uses this yet; the smoke-test route exercises
 *  it end-to-end and Stage 3 wires it into /api/render. */
export async function renderViaComfyUI(
  input: RenderViaComfyUIInput,
): Promise<RenderViaComfyUIResult> {
  const start = Date.now();
  // Timestamped + random-suffixed so concurrent renders never collide
  // on ComfyUI's input folder.
  const filename =
    input.filename ?? `mymaison-input-${Date.now()}-${randomUUID().slice(0, 8)}.png`;

  const uploaded = await uploadImageToComfyUI(input.roomBuf, filename);

  const workflow = buildImg2ImgWorkflow({
    inputImageFilename: uploaded.name,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt,
    denoise: input.denoise,
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    filenamePrefix: 'myMaison_smoketest',
  });

  const promptId = await submitWorkflow(workflow);
  const entry = await pollHistory(promptId);

  // Find the first output image across all nodes that produced one.
  // For our workflow this is node "8" (SaveImage); we don't hardcode
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
