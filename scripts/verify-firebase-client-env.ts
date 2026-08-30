#!/usr/bin/env tsx
/**
 * Verifies VITE_FIREBASE_* env matches .env files and probes Google APIs for Auth vs Firestore.
 */
import { loadProjectEnv } from '../server/config/loadProjectEnv.ts';
import {
  assertFirebaseConfigCoherence,
  validateFirebaseApiKeyForAuth,
} from '../src/lib/firebaseEnvValidation.ts';
import { validateRecaptchaSiteKey } from '../src/lib/appCheck/config.ts';

function read(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function mask(value: string): string {
  if (value.length <= 10) return '(empty or too short)';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function main(): Promise<number> {
  loadProjectEnv('development');

  const firebase = {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: read('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
    measurementId: read('VITE_FIREBASE_MEASUREMENT_ID') || undefined,
  };

  console.log('Firebase client env (masked):');
  console.log('  apiKey:', mask(firebase.apiKey));
  console.log('  authDomain:', firebase.authDomain);
  console.log('  projectId:', firebase.projectId);
  console.log('  appId:', firebase.appId);
  console.log('  messagingSenderId:', firebase.messagingSenderId);
  console.log('  storageBucket:', firebase.storageBucket);

  const appCheckKey = read('VITE_APP_CHECK_RECAPTCHA_SITE_KEY');
  const appCheckDisabled = read('VITE_APP_CHECK_DISABLED').toLowerCase() === 'true';
  if (!appCheckDisabled) {
    const siteKeyCheck = validateRecaptchaSiteKey(appCheckKey);
    console.log('  appCheck siteKey:', siteKeyCheck.ok ? mask(appCheckKey) : '(invalid)');
    if (!siteKeyCheck.ok) {
      console.error('  App Check site key: FAIL');
      console.error(`  ${siteKeyCheck.error}`);
      return 1;
    }
    console.log('  App Check site key: OK');
  } else {
    console.log('  App Check: disabled (VITE_APP_CHECK_DISABLED=true)');
  }

  try {
    assertFirebaseConfigCoherence(firebase);
    console.log('  config coherence: OK');
  } catch (error) {
    console.error('  config coherence: FAIL');
    console.error(`  ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  if (!firebase.apiKey || !firebase.projectId) {
    console.error('Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID in env files.');
    return 1;
  }

  const probe = await validateFirebaseApiKeyForAuth(firebase.apiKey, firebase.projectId);
  console.log('  Firestore API accepts key:', probe.firestoreKeyAccepted);
  console.log('  Identity Toolkit accepts key:', probe.authKeyAccepted);

  if (!probe.ok) {
    console.error(`\n${probe.hint}\n`);
    return 1;
  }

  console.log('\nFirebase client env and API key are valid for Authentication.\n');
  return 0;
}

main().then((code) => process.exit(code));
