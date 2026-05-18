import { fal } from '@fal-ai/client';
import { getServerEnv } from '@/lib/env';

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
export async function renderWithDepth(input: DepthRenderInput): Promise<DepthRenderOutput> {
  const client = getFal();
  const result = await client.subscribe('fal-ai/flux-control-lora-canny/image-to-image', {
    input: {
      prompt: input.prompt,
      image_url: input.controlImageUrl,
      control_lora_image_url: input.controlImageUrl,
      strength: 0.55,
      control_lora_strength: 0.85,
      image_size: input.width && input.height
        ? { width: input.width, height: input.height }
        : 'landscape_4_3',
      // 20 steps is the sweet spot for Flux dev — visible quality starts to
      // drop below ~15 and the marginal improvement above 20 isn't worth the
      // extra ~8s of inference time for interior renders.
      num_inference_steps: 20,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    },
    logs: false,
  });

  const data = result.data as { images?: Array<{ url: string }>; seed?: number };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal.ai returned no image');
  return { imageUrl: url, seed: data.seed ?? 0 };
}
