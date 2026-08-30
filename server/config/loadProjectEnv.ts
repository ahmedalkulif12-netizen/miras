import { loadEnv } from 'vite';

/**
 * Load `.env`, `.env.local`, `.env.[mode]`, and `.env.[mode].local` using Vite's
 * merge rules, then apply the result to `process.env` without overriding
 * environment variables already injected by the host platform (e.g. Cloud Run PORT).
 *
 * Why: `dotenv.config()` only reads `.env` and does not merge `.env.local`.
 * Vite gives existing `process.env` highest priority, so an early `dotenv.config()`
 * can block `.env.local` overrides and desync the Express server from the client bundle.
 */
export function loadProjectEnv(
  mode: string = process.env.NODE_ENV === 'production' ? 'production' : 'development',
  root: string = process.cwd()
): Record<string, string> {
  const merged = loadEnv(mode, root, '');

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
