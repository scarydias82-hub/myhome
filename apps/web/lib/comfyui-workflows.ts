// ComfyUI API-format workflow builders.
//
// ComfyUI workflows can be expressed in two formats — the UI graph
// format (what gets saved when you click "Save" in the canvas) and
// the API format (what gets POSTed to /prompt). They are NOT
// interchangeable. The API format is a flat object keyed by node ID,
// each value carrying { class_type, inputs }, where inputs can be
// scalars or [source_node_id, output_index] tuples for wired
// connections.
//
// The builders here emit API-format directly. Keeping the construction
// in one place makes interpolating runtime values (filename, seed,
// denoise, prompt) explicit, and avoids the need to load + patch a
// .json template at runtime.
//
// Stage 1 shipped buildImg2ImgWorkflow() (no ControlNet). Stage 2
// (this file) adds:
//   - An ImageScale node inserted into every workflow that normalises
//     the input image to a max long-side dimension. Without this,
//     full-resolution phone photos (12MP+) sent to ComfyUI's VAE
//     encode blow up activation memory and trigger SIGKILL via the
//     OS OOM killer on tight unified-RAM Macs. See OVERVIEW
//     changelog 2026-05-27 for the smoke-test investigation.
//   - buildModeCDepthWorkflow() — SDXL img2img + Depth ControlNet
//     (via comfyui_controlnet_aux's MiDaS preprocessor). Depth map
//     locks the room's geometry at the model level; denoising still
//     happens but it has to respect the structural constraint, which
//     is exactly what fixes the "hallucinated window where the dark
//     wall was" failure mode that Mode A keeps hitting.

export type ComfyUIWorkflow = Record<
  string,
  {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
  }
>;

/** Max long-side dimension we feed into the latent encode. SDXL's
 *  native res is 1024×1024; below that, output quality drops sharply,
 *  above it, M2 Max tight-RAM Macs OOM on CPU VAE encode. 1024 is the
 *  ceiling for high-VRAM setups; the smoketest route may override
 *  this to 512 for 32GB Macs running --cpu-vae. */
export const DEFAULT_MAX_LONG_SIDE = 1024;

export interface Img2ImgWorkflowInput {
  /** Filename of the room photo already uploaded to ComfyUI's input
   *  folder via /upload/image. Just the bare name — no path. */
  inputImageFilename: string;
  /** Positive prompt — what the rendered scene should look like. */
  positivePrompt: string;
  /** Negative prompt — what to push away from. Defaults to a sensible
   *  baseline ("blurry, watermark, text, low quality") if not given. */
  negativePrompt?: string;
  /** Denoise strength 0..1. Lower = more faithful to the input photo's
   *  structure; higher = freer interpretation. 0.6-0.7 preserves the
   *  bones of the room while letting palette + styling take. Default 0.7. */
  denoise?: number;
  /** Deterministic seed for repeatable A/B tests. Default = random. */
  seed?: number;
  /** Sampling steps. SDXL is fine at 20-25; more is rarely worth the
   *  latency. Default 20. */
  steps?: number;
  /** CFG scale — how strictly the model adheres to the prompt. SDXL
   *  works well at 6-8. Default 7. */
  cfg?: number;
  /** Checkpoint filename in ComfyUI/models/checkpoints/. Default is the
   *  SDXL base downloaded per docs/COMFYUI-SETUP.md Option B. */
  checkpointName?: string;
  /** Prefix for the saved output file. Lands in ComfyUI/output/<prefix>_*.png.
   *  Default 'myMaison_modeC'. */
  filenamePrefix?: string;
  /** Max long-side pixel dimension after the ImageScale node. Override
   *  to 512 for tight-RAM Macs running --cpu-vae; production setups
   *  with proper GPUs should leave at DEFAULT_MAX_LONG_SIDE (1024). */
  maxLongSide?: number;
}

const DEFAULT_NEGATIVE =
  'blurry, watermark, text, low quality, deformed, distorted, oversaturated, cartoon, illustration, painting';

/**
 * Build an SDXL img2img workflow targeted at preserving room structure
 * while restyling. No ControlNet — Stage 1 baseline.
 *
 * Node graph:
 *   LoadImage → ImageScale (resize) → VAEEncode → KSampler ← CLIP+/CLIP- ← Checkpoint
 *                                                     ↓
 *                                                 VAEDecode → SaveImage
 */
export function buildImg2ImgWorkflow(input: Img2ImgWorkflowInput): ComfyUIWorkflow {
  const checkpoint = input.checkpointName ?? 'sd_xl_base_1.0.safetensors';
  const negative = input.negativePrompt ?? DEFAULT_NEGATIVE;
  const denoise = input.denoise ?? 0.7;
  // Default steps bumped 20 → 35 on 2026-05-27 (PR #76). euler /
  // normal at 20 steps was producing soft "AI-fizz" on small details
  // — typical SDXL artefact at sub-native sampling budget. dpmpp_2m
  // with karras scheduler at 35 steps is the SDXL community default
  // for quality output; adds ~30% latency for noticeably cleaner
  // furniture surfaces and architectural detail.
  const steps = input.steps ?? 35;
  const cfg = input.cfg ?? 7;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const filenamePrefix = input.filenamePrefix ?? 'myMaison_modeC';
  const maxLongSide = input.maxLongSide ?? DEFAULT_MAX_LONG_SIDE;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
      _meta: { title: 'Load SDXL' },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: input.inputImageFilename },
      _meta: { title: 'Load input photo' },
    },
    '2a': {
      // ImageScale resizes to a target dimension. 'crop=disabled' +
      // 'upscale_method=lanczos' preserves aspect ratio by scaling the
      // long side to maxLongSide; the short side stays proportional.
      // SDXL handles non-square inputs fine; the latent will be
      // long-side/8 × short-side/8.
      class_type: 'ImageScale',
      inputs: {
        image: ['2', 0],
        upscale_method: 'lanczos',
        width: maxLongSide,
        height: maxLongSide,
        crop: 'disabled',
      },
      _meta: { title: `Resize to ${maxLongSide} long side` },
    },
    '3': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['2a', 0], vae: ['1', 2] },
      _meta: { title: 'Encode init latent' },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.positivePrompt, clip: ['1', 1] },
      _meta: { title: 'Positive prompt' },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['1', 1] },
      _meta: { title: 'Negative prompt' },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['3', 0],
        seed,
        steps,
        cfg,
        // Sampler bumped 2026-05-27 (PR #76): euler/normal → dpmpp_2m/karras.
        // dpmpp_2m is the SDXL community default — converges faster than
        // euler at higher step counts and produces sharper material/edge
        // detail. karras scheduler concentrates samples near the denoise
        // start where small details are decided. Combined with the
        // 20→35 step bump, this is the main quality lever on Mode C
        // output short of upgrading models.
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise,
      },
      _meta: { title: 'Sample' },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
      _meta: { title: 'Decode' },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: filenamePrefix },
      _meta: { title: 'Save output' },
    },
  };
}

export interface ModeCDepthWorkflowInput extends Img2ImgWorkflowInput {
  /** SDXL Depth ControlNet weights filename in models/controlnet/.
   *  Default matches docs/COMFYUI-SETUP.md Option B. */
  controlnetName?: string;
  /** ControlNet conditioning strength 0..1. 1.0 is the safest default —
   *  Depth ControlNet works best when it's allowed to fully constrain
   *  the depth-relevant features (walls, floor, ceiling, large furniture
   *  silhouettes). Drop to 0.7-0.8 if you want softer adherence and
   *  more creative liberty in re-styled regions. */
  controlnetStrength?: number;
  /** Where in the diffusion process ControlNet starts/stops being
   *  applied. Default 0.0..0.85 — full strength through most of the
   *  denoise, releasing at the tail so fine details can deviate from
   *  the depth map (otherwise outputs look stencil-traced). */
  controlnetStartPercent?: number;
  controlnetEndPercent?: number;
}

/**
 * Build an SDXL img2img workflow WITH Depth ControlNet conditioning.
 *
 * Adds three nodes on top of buildImg2ImgWorkflow's structure:
 *   MiDaS-DepthMapPreprocessor — derives a depth map from the input
 *                                photo using MiDaS (auto-downloads
 *                                weights on first run — ~1.3GB).
 *   ControlNetLoader — loads the SDXL Depth ControlNet weights.
 *   ControlNetApplyAdvanced — applies the depth-conditioned signal
 *                             onto the positive/negative conditioning
 *                             pair before sampling.
 *
 * The depth map locks the room's geometry. Combined with denoise 0.6-0.7,
 * the result preserves walls, floor, ceiling, and large furniture
 * silhouettes while letting the prompt + sampling re-style surface
 * colours, materials, and smaller decor.
 *
 * Requires comfyui_controlnet_aux installed (clone in custom_nodes/
 * per docs/COMFYUI-SETUP.md Step 3). The MiDaS preprocessor is preferred
 * over Depth Anything V2 because it auto-downloads its weights on first
 * use — no manual model file to babysit. Quality of the depth map is
 * comparable for SDXL ControlNet's purposes (the controlnet was trained
 * on MiDaS-style depth maps).
 */
export function buildModeCDepthWorkflow(input: ModeCDepthWorkflowInput): ComfyUIWorkflow {
  const base = buildImg2ImgWorkflow(input);

  const controlnetName = input.controlnetName ?? 'control_v11p_sdxl_depth.safetensors';
  const controlnetStrength = input.controlnetStrength ?? 1.0;
  const startPercent = input.controlnetStartPercent ?? 0.0;
  const endPercent = input.controlnetEndPercent ?? 0.85;

  return {
    ...base,
    '9': {
      class_type: 'MiDaS-DepthMapPreprocessor',
      inputs: {
        // Feed the *resized* image (node 2a) into the preprocessor
        // so the depth map is at sampling resolution. Feeding the
        // raw load (node 2) would either upsample the depth map
        // wastefully or require a redundant resize on the controlnet
        // side.
        image: ['2a', 0],
        a: 6.283185307179586, // 2π — MiDaS' default `a` parameter
        bg_threshold: 0.1, // background masking threshold; 0.1 is the standard default
        resolution: input.maxLongSide ?? DEFAULT_MAX_LONG_SIDE,
      },
      _meta: { title: 'Generate depth map (MiDaS)' },
    },
    '10': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: controlnetName },
      _meta: { title: 'Load Depth ControlNet' },
    },
    '11': {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['4', 0],
        negative: ['5', 0],
        control_net: ['10', 0],
        image: ['9', 0],
        strength: controlnetStrength,
        start_percent: startPercent,
        end_percent: endPercent,
      },
      _meta: { title: 'Apply Depth ControlNet' },
    },
    // Override the KSampler's positive/negative inputs to consume the
    // ControlNet-conditioned pair from node 11 instead of the raw CLIP
    // outputs. Everything else about node 6 (KSampler) is preserved.
    '6': {
      class_type: 'KSampler',
      _meta: base['6']?._meta,
      inputs: {
        ...(base['6']?.inputs ?? {}),
        positive: ['11', 0],
        negative: ['11', 1],
      },
    },
  };
}
