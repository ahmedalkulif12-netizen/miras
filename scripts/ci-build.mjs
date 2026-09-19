import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);

function run(script) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Render hosts the API / email worker, not the Firebase SPA. `vite build` needs
// VITE_FIREBASE_* and native Rollup binaries that are not present on the worker.
if (!isRender) {
  run('build:web');
} else {
  console.log('[ci-build] RENDER detected — skipping Vite SPA bundle, building API only');
}

run('build:server');
