#!/usr/bin/env tsx
/**
 * Replace VITE_FIREBASE_API_KEY across local env + legacy Firebase config files.
 *
 * Usage:
 *   tsx scripts/rotate-firebase-web-api-key.ts --key=AIzaSy...
 *   FIREBASE_WEB_API_KEY=AIzaSy... npm run rotate:firebase-api-key
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadProjectEnv } from '../server/config/loadProjectEnv.ts';

const ROOT = process.cwd();
const OLD_KEY_PATTERN = /VITE_FIREBASE_API_KEY=.*/;
const JSON_API_KEY_PATTERN = /"apiKey":\s*"[^"]*"/;
const BUNDLED_KEY_PATTERN = /VITE_FIREBASE_API_KEY:"[^"]+"/g;

function parseArgKey(): string {
  const arg = process.argv.find((a) => a.startsWith('--key='));
  if (arg) return arg.slice('--key='.length).trim();
  return process.env.FIREBASE_WEB_API_KEY?.trim() ?? '';
}

function assertKeyShape(key: string): void {
  if (!/^AIzaSy[A-Za-z0-9_-]{30,}$/.test(key)) {
    throw new Error(
      'Invalid Firebase Web API key format. Expected AIzaSy... from Google Cloud Console.'
    );
  }
}

function updateEnvFile(filePath: string, key: string): boolean {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, 'utf8');
  if (!text.includes('VITE_FIREBASE_API_KEY')) return false;
  const next = text.replace(OLD_KEY_PATTERN, `VITE_FIREBASE_API_KEY=${key}`);
  if (next === text) {
    throw new Error(`${filePath}: VITE_FIREBASE_API_KEY line not found`);
  }
  writeFileSync(filePath, next, 'utf8');
  return true;
}

function updateFirebaseAppletConfig(filePath: string, key: string): boolean {
  if (!existsSync(filePath)) return false;
  const json = JSON.parse(readFileSync(filePath, 'utf8')) as { apiKey?: string };
  json.apiKey = key;
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return true;
}

function patchDistBundle(distAssetsDir: string, key: string): number {
  if (!existsSync(distAssetsDir)) return 0;
  let patched = 0;
  for (const file of readdirSync(distAssetsDir)) {
    if (!file.endsWith('.js')) continue;
    const full = path.join(distAssetsDir, file);
    const text = readFileSync(full, 'utf8');
    if (!text.includes('VITE_FIREBASE_API_KEY')) continue;
    const next = text.replace(BUNDLED_KEY_PATTERN, `VITE_FIREBASE_API_KEY:"${key}"`);
    if (next !== text) {
      writeFileSync(full, next, 'utf8');
      patched++;
    }
  }
  return patched;
}

function mask(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function main(): number {
  const newKey = parseArgKey();
  if (!newKey) {
    console.error(
      'Missing key. Pass --key=AIzaSy... or set FIREBASE_WEB_API_KEY.\n' +
        'Create one in Google Cloud Console → APIs & Services → Credentials → Create credentials → API key,\n' +
        'then set Application restrictions = None and API restrictions = Don\'t restrict key (testing).'
    );
    return 1;
  }

  assertKeyShape(newKey);

  const updated: string[] = [];
  if (updateEnvFile(path.join(ROOT, '.env'), newKey)) updated.push('.env');
  if (updateEnvFile(path.join(ROOT, '.env.local'), newKey)) updated.push('.env.local');
  if (updateEnvFile(path.join(ROOT, '.env.production'), newKey)) updated.push('.env.production');
  if (updateFirebaseAppletConfig(path.join(ROOT, 'firebase-applet-config.json'), newKey)) {
    updated.push('firebase-applet-config.json');
  }

  const distPatched = patchDistBundle(path.join(ROOT, 'dist', 'assets'), newKey);
  if (distPatched > 0) updated.push(`dist/assets (${distPatched} bundle(s) patched)`);

  console.log(`Rotated Firebase Web API key to ${mask(newKey)}`);
  console.log('Updated:', updated.length ? updated.join(', ') : '(no files changed)');

  loadProjectEnv('development');
  if (process.env.VITE_FIREBASE_API_KEY !== newKey) {
    console.error('Post-rotate env load mismatch — check .env files.');
    return 1;
  }

  console.log('\nRunning npm run verify:firebase-client ...\n');
  const verify = spawnSync('npm', ['run', 'verify:firebase-client'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  return verify.status ?? 1;
}

process.exit(main());
