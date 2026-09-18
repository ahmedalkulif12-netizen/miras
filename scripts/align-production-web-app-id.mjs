/**
 * If `.env.production` accidentally has an iOS/Android Firebase app id,
 * copy the Web app id from `.env` without printing either value.
 * Usage: node scripts/align-production-web-app-id.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readValue(filePath, key) {
  if (!fs.existsSync(filePath)) return '';
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return '';
}

function upsertLine(filePath, key, value) {
  const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = original.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line.trim().startsWith(`${key}=`)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push(`${key}=${value}`);
  }
  const text = next.join('\n');
  if (text !== original) {
    fs.writeFileSync(filePath, text);
    return true;
  }
  return false;
}

const prodPath = path.join(root, '.env.production');
const devPath = path.join(root, '.env');
if (!fs.existsSync(prodPath)) {
  console.error('.env.production is missing. Copy .env.store.example → .env.production and fill Web Firebase config.');
  process.exit(1);
}

const prodId = readValue(prodPath, 'VITE_FIREBASE_APP_ID');
const devId = readValue(devPath, 'VITE_FIREBASE_APP_ID');
const prodKind = /:web:/i.test(prodId) ? 'web' : /:ios:/i.test(prodId) ? 'ios' : /:android:/i.test(prodId) ? 'android' : prodId ? 'unknown' : 'empty';
const devKind = /:web:/i.test(devId) ? 'web' : /:ios:/i.test(devId) ? 'ios' : /:android:/i.test(devId) ? 'android' : devId ? 'unknown' : 'empty';

if (prodKind !== 'web') {
  if (devKind !== 'web') {
    console.error(
      `Cannot align .env.production (app id kind=${prodKind}): .env does not have a Web app id (kind=${devKind}). ` +
        'Paste 1:…:web:… from Firebase Console → Project settings → Web app.'
    );
    process.exit(1);
  }
  upsertLine(prodPath, 'VITE_FIREBASE_APP_ID', devId);
  console.log(`Aligned .env.production VITE_FIREBASE_APP_ID from ${prodKind} to the Web app id in .env.`);
} else {
  console.log('VITE_FIREBASE_APP_ID in .env.production is already the Web app id.');
}

let deployChanged = false;
if (readValue(prodPath, 'VITE_MIRAS_DEPLOY_ENV') !== 'production') {
  upsertLine(prodPath, 'VITE_MIRAS_DEPLOY_ENV', 'production');
  deployChanged = true;
}
if (readValue(prodPath, 'MIRAS_DEPLOY_ENV') && readValue(prodPath, 'MIRAS_DEPLOY_ENV') !== 'production') {
  upsertLine(prodPath, 'MIRAS_DEPLOY_ENV', 'production');
  deployChanged = true;
}
if (readValue(prodPath, 'VITE_APP_CHECK_DISABLED') === 'true') {
  upsertLine(prodPath, 'VITE_APP_CHECK_DISABLED', 'false');
  deployChanged = true;
}
if (deployChanged) {
  console.log('Set store deploy flags in .env.production: VITE_MIRAS_DEPLOY_ENV=production, App Check enabled.');
}
