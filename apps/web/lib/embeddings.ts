// Local CLIP image encoder. Loads the model once per Node process and reuses
// it. We use it to embed cropped detection regions before vector-searching
// the products table.

import {
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  // The types are exported as well but we only use the runtime classes.
} from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';

type ImageBundle = {
  model: { (inputs: unknown): Promise<{ image_embeds: { tolist: () => number[][] } }> };
  processor: { (img: unknown): Promise<unknown> };
};
type TextBundle = {
  model: { (inputs: unknown): Promise<{ text_embeds: { tolist: () => number[][] } }> };
  tokenizer: { (texts: string[], opts: unknown): unknown };
};

let imagePromise: Promise<ImageBundle> | null = null;
let textPromise: Promise<TextBundle> | null = null;

function getImageModel() {
  if (!imagePromise) {
    imagePromise = (async () => {
      const [model, processor] = await Promise.all([
        CLIPVisionModelWithProjection.from_pretrained(MODEL),
        AutoProcessor.from_pretrained(MODEL),
      ]);
      return { model: model as never, processor: processor as never };
    })();
  }
  return imagePromise;
}

function getTextModel() {
  if (!textPromise) {
    textPromise = (async () => {
      const [model, tokenizer] = await Promise.all([
        CLIPTextModelWithProjection.from_pretrained(MODEL),
        AutoTokenizer.from_pretrained(MODEL),
      ]);
      return { model: model as never, tokenizer: tokenizer as never };
    })();
  }
  return textPromise;
}

// Embed an image from either a URL or raw bytes. Returns a 512-dim vector.
export async function embedImage(input: string | Uint8Array): Promise<number[]> {
  const { model, processor } = await getImageModel();
  const img =
    typeof input === 'string'
      ? await RawImage.fromURL(input)
      : await RawImage.fromBlob(new Blob([new Uint8Array(input)]));
  const inputs = await processor(img);
  const out = await model(inputs);
  const vec = out.image_embeds.tolist()[0];
  if (!vec) throw new Error('CLIP returned an empty embedding');
  return vec;
}

// Embed a text string using CLIP's text encoder. Outputs the same 512-dim
// projection as embedImage, so the two are comparable via cosine similarity.
// Used for the design-knowledge RAG retrieval.
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
// doesn't pay the load cost. Cheap to call repeatedly; the cached promise
// resolves immediately after the first run.
export async function warmEmbeddings(): Promise<void> {
  await Promise.all([getImageModel(), getTextModel()]);
}
