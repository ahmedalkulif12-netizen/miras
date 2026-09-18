#!/usr/bin/env tsx
/**
 * Fail-closed check for store / Hosting client builds.
 * Never prints secret values — only names and set/missing.
 */
import { loadProjectEnv } from '../server/config/loadProjectEnv.ts';
import { parseAndroidSha256Fingerprints } from './appleTeamId.mjs';

const REQUIRED_VITE = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_GOOGLE_MAPS_PLATFORM_KEY',
  'VITE_APP_CHECK_RECAPTCHA_SITE_KEY',
  'VITE_APP_URL',
] as const;

function has(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function main(): number {
  const requireAppLinks = process.argv.includes('--require-app-links');
  const requirePlist = process.argv.includes('--require-ios-plist');
  loadProjectEnv(process.env.VITE_MIRAS_DEPLOY_ENV === 'production' ? 'production' : 'development');

  const missing = REQUIRED_VITE.filter((name) => !has(name));
  if (missing.length) {
    console.error(`Missing client env: ${missing.join(', ')}`);
    console.error('Set these in Codemagic group miras_client (and local .env.production).');
    return 1;
  }

  const appUrl = process.env.VITE_APP_URL?.trim() || '';
  if (!appUrl.startsWith('https://')) {
    console.error('VITE_APP_URL must be an https:// origin (Moyasar / App Links callback).');
    return 1;
  }

  if (process.env.VITE_APP_CHECK_DISABLED === 'true' && process.env.VITE_MIRAS_DEPLOY_ENV === 'production') {
    console.error('VITE_APP_CHECK_DISABLED=true is forbidden when VITE_MIRAS_DEPLOY_ENV=production.');
    return 1;
  }

  if (process.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim() && process.env.VITE_MIRAS_DEPLOY_ENV === 'production') {
    console.error('VITE_APP_CHECK_DEBUG_TOKEN must be unset for production client builds.');
    return 1;
  }

  const forbidden = [
    'VITE_ENABLE_DEV_AUTH_BYPASS',
    'VITE_PHONE_AUTH_TESTING',
    'APPLE_REVIEW_PHONE',
    'APPLE_REVIEW_OTP',
  ] as const;
  for (const name of forbidden) {
    if (has(name) && process.env[name]?.trim() && process.env[name]?.trim() !== 'false') {
      console.error(`${name} must be unset for store / production client builds.`);
      return 1;
    }
  }

  if (requirePlist && !process.env.GOOGLE_SERVICE_INFO_PLIST?.trim()) {
    console.error('GOOGLE_SERVICE_INFO_PLIST (base64) is required in miras_client for iOS archives.');
    return 1;
  }

  const fingerprints = parseAndroidSha256Fingerprints(process.env);
  if (requireAppLinks && fingerprints.length === 0) {
    console.error(
      'VITE_ANDROID_SHA256_CERT_FINGERPRINTS is required. Play Console → App integrity → App signing → SHA-256 certificate fingerprint.'
    );
    return 1;
  }

  const firebaseAppId = process.env.VITE_FIREBASE_APP_ID?.trim() || '';
  if (/:(ios|android):/i.test(firebaseAppId)) {
    console.error(
      `VITE_FIREBASE_APP_ID must be the Web app id (1:…:web:…), not ${firebaseAppId}. ` +
        'Native iOS/Android ids belong only in GoogleService-Info.plist / google-services.json. ' +
        'Using an iOS id with reCAPTCHA v3 causes "App not registered".'
    );
    return 1;
  }
  if (firebaseAppId && !/:web:/i.test(firebaseAppId)) {
    console.error(
      `VITE_FIREBASE_APP_ID must include :web: (got ${firebaseAppId}). Copy the Web app config from Firebase Console.`
    );
    return 1;
  }

  console.log('Store client env: OK');
  console.log(`  VITE_FIREBASE_PROJECT_ID=${process.env.VITE_FIREBASE_PROJECT_ID}`);
  console.log(`  VITE_APP_URL set (${appUrl.length} chars)`);
  console.log(`  App Links fingerprints: ${fingerprints.length}`);
  return 0;
}

process.exitCode = main();
