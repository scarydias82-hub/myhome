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
// Stage 1 ships img2img only (no ControlNet) so the wire-up — upload
// image → submit workflow → poll → fetch — can be validated against
// the tunnel without depending on Depth Anything weights or the
// controlnet_aux preprocessor node names. Stage 2 will layer Depth
// ControlNet on top of this same builder.

export type ComfyUIWorkflow = Record<
  string,
  {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
  }
>;

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
}

const DEFAULT_NEGATIVE =
  'blurry, watermark, text, low quality, deformed, distorted, oversaturated, cartoon, illustration, painting';

/**
 * Build an SDXL img2img workflow targeted at preserving room structure
 * while restyling. No ControlNet — Stage 1 baseline.
 */
export function buildImg2ImgWorkflow(input: Img2ImgWorkflowInput): ComfyUIWorkflow {
  const checkpoint = input.checkpointName ?? 'sd_xl_base_1.0.safetensors';
  const negative = input.negativePrompt ?? DEFAULT_NEGATIVE;
  const denoise = input.denoise ?? 0.7;
  const steps = input.steps ?? 20;
  const cfg = input.cfg ?? 7;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const filenamePrefix = input.filenamePrefix ?? 'myMaison_modeC';

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
    '3': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['2', 0], vae: ['1', 2] },
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
        sampler_name: 'euler',
        scheduler: 'normal',
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
