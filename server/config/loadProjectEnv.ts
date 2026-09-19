import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Load `.env`, `.env.local`, `.env.[mode]`, and `.env.[mode].local` using Vite's
 * merge rules, then apply the result to `process.env` without overriding
 * environment variables already injected by the host platform (e.g. Cloud Run PORT).
 *
 * Implemented with `dotenv` instead of `vite.loadEnv` so production `node dist/server.cjs`
 * and the Render worker never `require()` ESM Vite / optional Rollup natives at boot.
 */
export function loadProjectEnv(
  mode: string = process.env.NODE_ENV === 'production' ? 'production' : 'development',
  root: string = process.cwd()
): Record<string, string> {
  const files = [`.env`, `.env.local`, `.env.${mode}`, `.env.${mode}.local`];
  const merged: Record<string, string> = {};

  for (const file of files) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;
    const parsed = dotenv.parse(fs.readFileSync(fullPath));
    for (const [key, value] of Object.entries(parsed)) {
      merged[key] = value;
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === '') {
      continue;
    }

    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }

  return merged;
}
