import { spawn } from 'node:child_process';

/**
 * Production Vite build for Capacitor. Sets CAPACITOR_BUILD so vite.config.ts
 * emits relative asset URLs (./assets/…) that WKWebView can load.
 */
process.env.CAPACITOR_BUILD = '1';

const child = spawn('npx', ['vite', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
