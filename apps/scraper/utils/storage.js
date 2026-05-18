import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeJson(filepath, data) {
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, JSON.stringify(data, null, 2) + '\n');
}

export function retailerOutputDir(slug) {
  return path.join(process.cwd(), 'output', slug);
}
