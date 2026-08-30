/**
 * Verifies Firebase Auth Authorized Domains include Hosting + local Phone Auth hosts.
 *
 * Usage:
 *   npx tsx scripts/verify-auth-authorized-domains.ts
 *
 * Reads VITE_FIREBASE_API_KEY + VITE_FIREBASE_PROJECT_ID from .env / process env.
 * Prints missing domains that cause auth/captcha-check-failed ("Hostname match not found").
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const file of ['.env.local', '.env']) {
  const abs = resolve(process.cwd(), file);
  if (existsSync(abs)) loadDotenv({ path: abs, override: false });
}

const apiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
const projectId = (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
const authDomain = (process.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
const extra = (process.env.VITE_AUTH_EXTRA_AUTHORIZED_DOMAINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!apiKey || !projectId) {
  console.error('Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID');
  process.exit(1);
}

const requiredHosting = Array.from(
  new Set([`${projectId}.firebaseapp.com`, `${projectId}.web.app`, ...extra])
);
const recommendedLocal = ['127.0.0.1'];

const url =
  'https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=' +
  encodeURIComponent(apiKey);

const res = await fetch(url);
const json = (await res.json()) as {
  projectId?: string;
  authorizedDomains?: string[];
  error?: { message?: string };
};

if (!res.ok || json.error) {
  console.error('Failed to read project config:', json.error?.message || res.statusText);
  process.exit(1);
}

const domains = json.authorizedDomains ?? [];
console.log(`\nFirebase project: ${json.projectId || projectId}`);
console.log(`VITE_FIREBASE_AUTH_DOMAIN: ${authDomain || '(unset)'}`);
console.log(`Authorized domains (${domains.length}):`);
for (const d of domains) console.log(`  - ${d}`);

const missingHosting = requiredHosting.filter((d) => !domains.includes(d));
const missingLocal = recommendedLocal.filter((d) => !domains.includes(d));

console.log('\nRequired for Hosting Phone Auth:');
for (const d of requiredHosting) {
  const ok = domains.includes(d);
  console.log(`  ${ok ? 'OK ' : 'MISSING '} ${d}`);
}

console.log('\nRecommended for local Phone Auth:');
for (const d of recommendedLocal) {
  const ok = domains.includes(d);
  console.log(`  ${ok ? 'OK ' : 'MISSING '} ${d}`);
}

if (authDomain && authDomain !== `${projectId}.firebaseapp.com`) {
  console.warn(
    `\nWARNING: VITE_FIREBASE_AUTH_DOMAIN should be ${projectId}.firebaseapp.com (got ${authDomain}).`
  );
}

if (missingLocal.length) {
  console.warn(
    `\nLocal OTP tip: add ${missingLocal.join(', ')} under Authentication → Settings → Authorized domains ` +
      `(use http://127.0.0.1 — not localhost).`
  );
}

if (missingHosting.length) {
  console.error(`\nAdd these under Firebase Console → Authentication → Settings → Authorized domains:`);
  for (const d of missingHosting) console.error(`  • ${d}`);
  console.error(
    '\nAlso allow the same hosts on the App Check reCAPTCHA v3 key Domains list ' +
      '(Google Cloud → reCAPTCHA). Then hard-refresh https://' +
      `${projectId}.web.app` +
      ' and retry OTP.'
  );
  process.exit(2);
}

console.log('\nHosting Phone Auth domains are present.');
console.log(
  'Reminder: App Check reCAPTCHA key Domains must also include web.app + firebaseapp.com ' +
    '(updated via gcloud recaptcha keys update).'
);
