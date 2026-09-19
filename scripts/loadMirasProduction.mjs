import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadMirasProduction() {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'config', 'miras-production.json'), 'utf8')
  );
}
