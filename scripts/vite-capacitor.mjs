import { spawn } from 'node:child_process';

/**
 * Production Vite build for Capacitor. Sets CAPACITOR_BUILD so vite.config.ts
 * emits relative asset URLs (./assets/…) that WKWebView can load.
 * Only applied to the child process so a later web build in the same shell
 * does not inherit base="./".
 */
const child = spawn('npx', ['vite', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CAPACITOR_BUILD: '1' },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
