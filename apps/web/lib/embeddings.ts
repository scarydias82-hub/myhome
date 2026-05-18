// Local CLIP image + text encoders. Loaded lazily (dynamic import) so the
// rest of the server bundle isn't blocked when the underlying ONNX Runtime
// native module is unavailable — e.g. on Vercel serverless where the .so
// binary doesn't always load. Callers that fail are caught upstream and the
// pipeline degrades gracefully (empty picking list, no broken renders).

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

const MODEL = 'Xenova/clip-vit-base-patch32';

let imagePromise: Promise<{ image: ImageBundle; rawImage: RawImageStatic }> | null = null;
let textPromise: Promise<TextBundle> | null = null;

async function loadTransformers() {
  // Dynamic import so the native ONNX Runtime addon only loads when
  // embedImage / embedText is actually called (not at module-init time).
  return await import('@huggingface/transformers');
}

function getImageModel() {
  if (!imagePromise) {
    imagePromise = (async () => {
      const transformers = await loadTransformers();
      const [model, processor] = await Promise.all([
        transformers.CLIPVisionModelWithProjection.from_pretrained(MODEL),
        transformers.AutoProcessor.from_pretrained(MODEL),
      ]);
      return {
        image: { model: model as never, processor: processor as never },
        rawImage: transformers.RawImage as unknown as RawImageStatic,
      };
    })();
  }
  return imagePromise;
}

function getTextModel() {
  if (!textPromise) {
    textPromise = (async () => {
      const transformers = await loadTransformers();
      const [model, tokenizer] = await Promise.all([
        transformers.CLIPTextModelWithProjection.from_pretrained(MODEL),
        transformers.AutoTokenizer.from_pretrained(MODEL),
      ]);
      return { model: model as never, tokenizer: tokenizer as never };
    })();
  }
  return textPromise;
}

// Embed an image from either a URL or raw bytes. Returns a 512-dim vector.
export async function embedImage(input: string | Uint8Array): Promise<number[]> {
  const { image, rawImage } = await getImageModel();
  const img =
    typeof input === 'string'
      ? await rawImage.fromURL(input)
      : await rawImage.fromBlob(new Blob([new Uint8Array(input)]));
  const inputs = await image.processor(img);
  const out = await image.model(inputs);
  const vec = out.image_embeds.tolist()[0];
  if (!vec) throw new Error('CLIP returned an empty embedding');
  return vec;
}

// Embed a text string using CLIP's text encoder. Outputs the same 512-dim
// projection as embedImage, so the two are comparable via cosine similarity.
export async function embedText(text: string): Promise<number[]> {
  const { model, tokenizer } = await getTextModel();
  const inputs = (tokenizer as (texts: string[], opts: unknown) => unknown)([text], {
    padding: true,
    truncation: true,
  });
  const out = await model(inputs);
  const vec = out.text_embeds.tolist()[0];
  if (!vec) throw new Error('CLIP returned an empty text embedding');
  return vec;
}

// Warm the model — useful to call during user onboarding so the first render
// doesn't pay the load cost. Cheap to call repeatedly.
export async function warmEmbeddings(): Promise<void> {
  // Tolerate failure (e.g. Vercel native-binary load issue) — warming is a
  // best-effort optimisation, not a hard requirement.
  await Promise.all([getImageModel(), getTextModel()]).catch(() => {});
}
