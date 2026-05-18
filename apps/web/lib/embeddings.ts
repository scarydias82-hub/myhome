// CLIP image + text encoders with a dual-runtime strategy:
//
//   - LOCAL (default, used in dev): @huggingface/transformers runs CLIP
//     in-process via onnxruntime-node. Free, fast, deterministic, works
//     on any Linux/macOS with the native bindings.
//
//   - REMOTE (used on Vercel + anywhere HF_TOKEN is set): HuggingFace
//     Inference API. Bypasses the native binary entirely, which avoids
//     the libonnxruntime.so loading failure on Vercel serverless.
//
// Both paths output the same 512-dim CLIP ViT-B/32 projection, so
// cross-comparison via cosine similarity works regardless of which side
// generated the vector. Embeddings written by the offline scripts (using
// the LOCAL path) are query-compatible with vectors generated REMOTELY
// at render time.

import { getServerEnv } from '@/lib/env';

const HF_MODEL = 'sentence-transformers/clip-ViT-B-32';
const HF_INFERENCE_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;

// --- LOCAL ---------------------------------------------------------------

type ImageBundle = {
  model: { (inputs: unknown): Promise<{ image_embeds: { tolist: () => number[][] } }> };
  processor: { (img: unknown): Promise<unknown> };
};
type TextBundle = {
  model: { (inputs: unknown): Promise<{ text_embeds: { tolist: () => number[][] } }> };
  tokenizer: { (texts: string[], opts: unknown): unknown };
};
type RawImageStatic = {
  fromURL: (url: string) => Promise<unknown>;
  fromBlob: (blob: Blob) => Promise<unknown>;
};

const LOCAL_MODEL = 'Xenova/clip-vit-base-patch32';

let imagePromise: Promise<{ image: ImageBundle; rawImage: RawImageStatic }> | null = null;
let textPromise: Promise<TextBundle> | null = null;

async function loadTransformers() {
  return await import('@huggingface/transformers');
}

function getLocalImageModel() {
  if (!imagePromise) {
    imagePromise = (async () => {
      const transformers = await loadTransformers();
      const [model, processor] = await Promise.all([
        transformers.CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL),
        transformers.AutoProcessor.from_pretrained(LOCAL_MODEL),
      ]);
      return {
        image: { model: model as never, processor: processor as never },
        rawImage: transformers.RawImage as unknown as RawImageStatic,
      };
    })();
  }
  return imagePromise;
}

function getLocalTextModel() {
  if (!textPromise) {
    textPromise = (async () => {
      const transformers = await loadTransformers();
      const [model, tokenizer] = await Promise.all([
        transformers.CLIPTextModelWithProjection.from_pretrained(LOCAL_MODEL),
        transformers.AutoTokenizer.from_pretrained(LOCAL_MODEL),
      ]);
      return { model: model as never, tokenizer: tokenizer as never };
    })();
  }
  return textPromise;
}

async function embedImageLocal(input: string | Uint8Array): Promise<number[]> {
  const transformers = await loadTransformers();
  const { image, rawImage } = await getLocalImageModel();
  const img =
    typeof input === 'string'
      ? await rawImage.fromURL(input)
      : await rawImage.fromBlob(new Blob([new Uint8Array(input)]));
  void transformers; // keep import in dependency graph
  const inputs = await image.processor(img);
  const out = await image.model(inputs);
  const vec = out.image_embeds.tolist()[0];
  if (!vec) throw new Error('CLIP returned an empty embedding');
  return vec;
}

async function embedTextLocal(text: string): Promise<number[]> {
  const { model, tokenizer } = await getLocalTextModel();
  const inputs = (tokenizer as (texts: string[], opts: unknown) => unknown)([text], {
    padding: true,
    truncation: true,
  });
  const out = await model(inputs);
  const vec = out.text_embeds.tolist()[0];
  if (!vec) throw new Error('CLIP returned an empty text embedding');
  return vec;
}

// --- REMOTE (HuggingFace Inference API) -----------------------------------

async function fetchImageBytes(input: string | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  const res = await fetch(input);
  if (!res.ok) throw new Error(`Could not fetch image for embedding: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function callHF(body: BodyInit, headers: HeadersInit): Promise<unknown> {
  const { HF_TOKEN } = getServerEnv();
  if (!HF_TOKEN) throw new Error('HF_TOKEN missing');
  // HF Inference API can cold-start; retry once on 503 (model loading).
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(HF_INFERENCE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_TOKEN}`, ...headers },
      body,
    });
    if (res.ok) return res.json();
    if (res.status === 503 && attempt === 0) {
      // Wait for model warm-up then retry.
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const text = await res.text();
    throw new Error(`HF Inference ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new Error('HF Inference: exhausted retries');
}

async function embedImageRemote(input: string | Uint8Array): Promise<number[]> {
  const bytes = await fetchImageBytes(input);
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
  const result = await callHF(blob, { 'Content-Type': 'image/jpeg' });
  return normaliseHFOutput(result);
}

async function embedTextRemote(text: string): Promise<number[]> {
  const result = await callHF(JSON.stringify({ inputs: text }), {
    'Content-Type': 'application/json',
  });
  return normaliseHFOutput(result);
}

// HF returns either number[] or number[][] depending on input shape; flatten
// to a single 512-dim vector.
function normaliseHFOutput(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    Array.isArray(raw[0]) &&
    typeof (raw[0] as unknown[])[0] === 'number'
  ) {
    return (raw[0] as number[]);
  }
  throw new Error('HF returned unexpected embedding shape');
}

// --- Public API -----------------------------------------------------------

function useRemote(): boolean {
  try {
    const { HF_TOKEN } = getServerEnv();
    return Boolean(HF_TOKEN);
  } catch {
    return false;
  }
}

export async function embedImage(input: string | Uint8Array): Promise<number[]> {
  if (useRemote()) {
    try {
      return await embedImageRemote(input);
    } catch (err) {
      console.error('Remote embedding failed, falling back to local:', err);
      // fall through
    }
  }
  return embedImageLocal(input);
}

export async function embedText(text: string): Promise<number[]> {
  if (useRemote()) {
    try {
      return await embedTextRemote(text);
    } catch (err) {
      console.error('Remote text embedding failed, falling back to local:', err);
      // fall through
    }
  }
  return embedTextLocal(text);
}

export async function warmEmbeddings(): Promise<void> {
  // No-op on remote; only the local path benefits from warmth.
  if (useRemote()) return;
  await Promise.all([getLocalImageModel(), getLocalTextModel()]).catch(() => {});
}
