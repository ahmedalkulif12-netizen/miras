import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['dist', '.vite', path.join('node_modules', '.cache')];

for (const rel of targets) {
  const abs = path.join(root, rel);
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`Removed ${rel}`);
  } catch (error) {
    console.warn(`Could not remove ${rel}:`, error instanceof Error ? error.message : error);
  }
}

console.log('Clean complete.');
