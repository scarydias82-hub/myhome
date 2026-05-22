// Client-side image preparation for upload routes.
//
// Two jobs:
//   1. HEIC conversion — iPhone Photos defaults to HEIC; browsers
//      and our API don't speak it. We convert to JPEG client-side
//      using heic-to (primary) → heic2any (fallback).
//   2. Resize — modern phone photos are 8-15 MB. Vercel multipart
//      caps at 4.5 MB, our API caps at 4 MB. We downscale to
//      1600px max dimension at JPEG q=0.88, which lands comfortably
//      under the cap while keeping plenty of detail for Claude
//      vision + Flux pipelines.
//
// Returns a usable File. The caller posts it as-is via FormData.
//
// This helper is referenced by both /rooms/new's UploadForm and
// vision-boards' BoardImageUpload — historically duplicated; now
// shared so a fix lands everywhere.

export interface PrepareImageOptions {
  /** Maximum dimension (longest side) after resize. Default 1600. */
  maxDim?: number;
  /** Threshold above which resize runs. Default 3.5 MB. */
  maxBytes?: number;
  /** JPEG quality for the resize. Default 0.88. */
  quality?: number;
}

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_MAX_BYTES = 3.5 * 1024 * 1024; // comfortably under Vercel's 4.5 MB cap
const DEFAULT_QUALITY = 0.88;

const HEIC_RE = /^image\/(heic|heif)$/i;
const HEIC_EXT_RE = /\.(heic|heif)$/i;

export async function prepareImageForUpload(
  file: File,
  options: PrepareImageOptions = {},
): Promise<File> {
  const isHeic = HEIC_RE.test(file.type) || HEIC_EXT_RE.test(file.name);

  let usable = file;

  if (isHeic) {
    try {
      const jpegBlob = await convertHeicToJpeg(file);
      const baseName = file.name.replace(HEIC_EXT_RE, '') || 'image';
      usable = new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
    } catch (err) {
      // If HEIC conversion fails the caller can surface a clearer
      // error than letting an unhandled rejection bubble up. We
      // intentionally rethrow with a clean message rather than
      // returning the original (which the server won't accept).
      throw new Error(
        `Could not convert HEIC. Export as JPG from Photos. Underlying: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Resize step. We run it whether or not the source was HEIC —
  // converted JPEGs can still be huge if the original was a 12 MP
  // shot. resizeForUpload bails fast when the file is already small.
  try {
    usable = await resizeForUpload(usable, options);
  } catch (err) {
    // Resize is a best-effort path. If it fails we send the file
    // as-is and let the API reject it with its own size check.
    console.warn('[prepareImageForUpload] resize failed, sending original', err);
  }

  return usable;
}

async function convertHeicToJpeg(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/heic' });
  // Try heic-to first (smaller bundle, better track record on recent
  // iOS-encoded HEIC files). Fall back to heic2any for older formats.
  try {
    const mod = await import('heic-to');
    const result = await mod.heicTo({ blob, type: 'image/jpeg', quality: 0.92 });
    if (result instanceof Blob) return result;
  } catch (primary) {
    console.warn('heic-to failed, trying heic2any', primary);
  }
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
  const result = Array.isArray(out) ? out[0] : out;
  if (!result) throw new Error('heic2any returned no blob');
  return result;
}

async function resizeForUpload(
  file: File,
  options: PrepareImageOptions,
): Promise<File> {
  const maxDim = options.maxDim ?? DEFAULT_MAX_DIM;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const quality = options.quality ?? DEFAULT_QUALITY;

  if (file.size <= maxBytes) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
