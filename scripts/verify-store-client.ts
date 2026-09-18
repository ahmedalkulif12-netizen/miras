#!/usr/bin/env tsx
/**
 * Fail-closed check for store / Hosting client builds.
 * Always reads production env files so local `cap:sync:ios:store` matches Vite.
 * Never prints secret values — only names, kinds, and set/missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from '../server/config/loadProjectEnv.ts';
import { parseAndroidSha256Fingerprints } from './appleTeamId.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function readEnvFile(rel: string): Record<string, string> {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function plistString(xml: string, key: string): string {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]?.trim() || '';
}

function appIdKind(appId: string): 'web' | 'ios' | 'android' | 'unknown' {
  if (/:web:/i.test(appId)) return 'web';
  if (/:ios:/i.test(appId)) return 'ios';
  if (/:android:/i.test(appId)) return 'android';
  return 'unknown';
}

function main(): number {
  const requireAppLinks = process.argv.includes('--require-app-links');
  const requirePlist = process.argv.includes('--require-ios-plist');
  // Store binaries bake `.env.production` via `vite build`. Never audit `.env` alone.
  loadProjectEnv('production');

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

  const productionFile = {
    ...readEnvFile('.env.production'),
    ...readEnvFile('.env.production.local'),
  };
  if (productionFile.VITE_APP_CHECK_DEBUG_TOKEN?.trim()) {
    console.error('VITE_APP_CHECK_DEBUG_TOKEN must be unset in .env.production for store client builds.');
    return 1;
  }

  const forbidden = [
    'VITE_ENABLE_DEV_AUTH_BYPASS',
    'VITE_PHONE_AUTH_TESTING',
    'APPLE_REVIEW_PHONE',
    'APPLE_REVIEW_OTP',
  ] as const;
  for (const name of forbidden) {
    const fromProd = productionFile[name]?.trim();
    if (fromProd && fromProd !== 'false') {
      console.error(`${name} must be unset in .env.production for store / production client builds.`);
      return 1;
    }
  }

  const localPlistPath = path.join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');
  const hasLocalPlist = fs.existsSync(localPlistPath);
  if (requirePlist && !process.env.GOOGLE_SERVICE_INFO_PLIST?.trim() && !hasLocalPlist) {
    console.error(
      'GOOGLE_SERVICE_INFO_PLIST (base64) or ios/App/App/GoogleService-Info.plist is required for iOS archives.'
    );
    return 1;
  }
  if (hasLocalPlist) {
    const xml = fs.readFileSync(localPlistPath, 'utf8');
    const bundleId = plistString(xml, 'BUNDLE_ID');
    const googleAppId = plistString(xml, 'GOOGLE_APP_ID');
    const projectId = plistString(xml, 'PROJECT_ID');
    if (bundleId !== 'com.ahmed.miras') {
      console.error(`GoogleService-Info.plist BUNDLE_ID must be com.ahmed.miras (got ${bundleId || 'empty'}).`);
      return 1;
    }
    if (appIdKind(googleAppId) !== 'ios') {
      console.error('GoogleService-Info.plist GOOGLE_APP_ID must be the Firebase iOS app id (1:…:ios:…).');
      return 1;
    }
    if (projectId && projectId !== process.env.VITE_FIREBASE_PROJECT_ID?.trim()) {
      console.error('GoogleService-Info.plist PROJECT_ID does not match VITE_FIREBASE_PROJECT_ID.');
      return 1;
    }
  }

  const fingerprints = parseAndroidSha256Fingerprints(process.env);
  if (requireAppLinks && fingerprints.length === 0) {
    console.error(
      'VITE_ANDROID_SHA256_CERT_FINGERPRINTS is required. Play Console → App integrity → App signing → SHA-256 certificate fingerprint.'
    );
    return 1;
  }

  const firebaseAppId = (productionFile.VITE_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '').trim();
  const kind = appIdKind(firebaseAppId);
  if (kind === 'ios' || kind === 'android') {
    console.error(
      `VITE_FIREBASE_APP_ID in .env.production is a native ${kind} app id. ` +
        'The JS SDK must use the Web app id (1:…:web:…). Native ids belong only in GoogleService-Info.plist / google-services.json. ' +
        'Using an iOS id with reCAPTCHA v3 causes "App not registered" / FAILED_PRECONDITION on TestFlight.'
    );
    return 1;
  }
  if (kind !== 'web') {
    console.error('VITE_FIREBASE_APP_ID must include :web:. Copy the Web app config from Firebase Console.');
    return 1;
  }

  const deployEnv =
    productionFile.VITE_MIRAS_DEPLOY_ENV ||
    process.env.VITE_MIRAS_DEPLOY_ENV ||
    productionFile.MIRAS_DEPLOY_ENV ||
    '';
  if (deployEnv.trim() && deployEnv.trim() !== 'production') {
    console.error(`VITE_MIRAS_DEPLOY_ENV must be production for store builds (got ${deployEnv.trim()}).`);
    return 1;
  }

  console.log('Store client env: OK');
  console.log(`  VITE_FIREBASE_PROJECT_ID=${process.env.VITE_FIREBASE_PROJECT_ID}`);
  console.log(`  VITE_FIREBASE_APP_ID kind=${kind}`);
  console.log(`  VITE_APP_URL set (${appUrl.length} chars)`);
  console.log(`  GoogleService-Info.plist: ${hasLocalPlist ? 'present' : 'missing locally (Codemagic injects it)'}`);
  console.log(`  App Links fingerprints: ${fingerprints.length}`);
  return 0;
}

process.exitCode = main();
