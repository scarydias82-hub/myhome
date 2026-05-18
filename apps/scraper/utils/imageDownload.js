import { mkdir, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { USER_AGENT } from './userAgent.js';

const MAX_WIDTH = 1200;

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

// Download an image URL, resize to <=1200px wide, write JPEG.
// Returns { localPath, downloaded } where localPath is relative to repo root.
export async function downloadImage({ url, retailerDir, slug, index = 0 }) {
  const imagesDir = path.join(retailerDir, 'images');
  await ensureDir(imagesDir);
  const filename = `${slug}-${index}.jpg`;
  const absPath = path.join(imagesDir, filename);
  const localPath = path.relative(process.cwd(), absPath);

  if (await exists(absPath)) {
    return { localPath, downloaded: true, sourceUrl: url };
  }

  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Image fetch ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const resized = await sharp(buf)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  await writeFile(absPath, resized);
  return { localPath, downloaded: true, sourceUrl: url };
}
