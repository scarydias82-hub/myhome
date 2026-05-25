import { mkdir, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { USER_AGENT } from './userAgent.js';

// Default downscale target. Most catalogue surfaces (cards, carousels,
// picking-list thumbs) render under 600px on screen — 1200px hi-DPI
// gives us a safe ceiling without burning storage.
const MAX_WIDTH = 1200;

// Quality cap used when re-encoding to JPEG. Visually lossless at 85.
const JPEG_QUALITY = 85;

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Download an image URL and write it to <retailerDir>/images/<slug>-<index>.<ext>.
// Returns { localPath, downloaded, sourceUrl } where localPath is
// relative to repo root.
//
// Modes:
//   - Default (resize: true): downscale to <=1200px wide, re-encode as
//     JPEG q85. Used for catalogue thumbnails / vision-profile work
//     where storage economy beats native resolution.
//   - resize: false: preserve source bytes exactly — no resize, no
//     re-encode. Used by retailers that publish proper hi-res images
//     (Coco Republic at 2560px wide, etc.) where the extra fidelity
//     matters for vision-grounded matching or render-substitution
//     compositing. Extension is detected from Content-Type so a webp
//     source lands as .webp, a jpg source as .jpg.
export async function downloadImage({ url, retailerDir, slug, index = 0, resize = true }) {
  const imagesDir = path.join(retailerDir, 'images');
  await ensureDir(imagesDir);

  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Image fetch ${res.status} for ${url}`);
  }

  // Pick filename extension. Default mode always writes .jpg because
  // we re-encode. Native mode preserves the source format so vision
  // tooling that prefers original encoding gets it.
  const ext = resize ? 'jpg' : extensionFromResponse(res, url);
  const filename = `${slug}-${index}.${ext}`;
  const absPath = path.join(imagesDir, filename);
  const localPath = path.relative(process.cwd(), absPath);

  if (await exists(absPath)) {
    return { localPath, downloaded: true, sourceUrl: url };
  }

  const buf = Buffer.from(await res.arrayBuffer());

  if (resize) {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    await writeFile(absPath, out);
  } else {
    // Native mode: write the raw bytes as-is, no decode/encode round-trip.
    // Skips orientation auto-rotate too — assumed correct from source.
    await writeFile(absPath, buf);
  }

  return { localPath, downloaded: true, sourceUrl: url };
}

// Maps the response's Content-Type (with URL extension as fallback)
// to a sensible filename extension. Defaults to jpg if both signals
// are absent — the file still opens, just may have a slightly wrong
// extension which downstream tooling tolerates.
function extensionFromResponse(res, url) {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/avif') return 'avif';
  if (ct === 'image/gif') return 'gif';
  // URL-based fallback when CDN omits / mis-sets Content-Type.
  const urlExt = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(urlExt)) {
    return urlExt === 'jpeg' ? 'jpg' : urlExt;
  }
  return 'jpg';
}
