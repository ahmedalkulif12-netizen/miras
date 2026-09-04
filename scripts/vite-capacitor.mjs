import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Production Vite build for Capacitor. Sets CAPACITOR_BUILD so vite.config.ts
 * emits relative asset URLs (./assets/…) that WKWebView can load.
 * Only applied to the child process so a later web build in the same shell
 * does not inherit base="./".
 */
const child = spawn('npx', ['vite', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    CAPACITOR_BUILD: '1',
    NODE_ENV: process.env.NODE_ENV || 'production',
  },
});

child.on('exit', (code) => {
  if (code) process.exit(code);
  const indexHtml = path.join(process.cwd(), 'dist', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error(
      `Vite did not emit ${indexHtml}. Capacitor sync needs dist/index.html (the CLI error mentions \`npm run build\`).`
    );
    process.exit(1);
  }
  process.exit(0);
});
