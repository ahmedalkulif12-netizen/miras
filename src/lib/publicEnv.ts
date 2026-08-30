import type { FirebaseOptions } from 'firebase/app';
import { assertFirebaseConfigCoherence } from '@/lib/firebaseEnvValidation';
import {
  normalizeRecaptchaSiteKey,
  validateRecaptchaSiteKey,
} from '@/lib/appCheck/config';

/**
 * P0-15: Client-safe configuration — ONLY `import.meta.env.VITE_*` values.
 * Never add server secrets (Moyasar secret, webhook secret, service accounts) here.
 */
export interface ClientPublicEnv {
  firebase: FirebaseOptions;
  googleMapsApiKey: string;
  appCheck: {
    debugToken?: string;
    recaptchaSiteKey?: string;
  };
  deployEnv: 'development' | 'staging' | 'production';
  isDevelopment: boolean;
}

function readVite(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv];
  return typeof value === 'string' ? value.trim() : '';
}

export function getClientPublicEnv(): ClientPublicEnv {
  const deployRaw =
    readVite('VITE_MIRAS_DEPLOY_ENV') ||
    readVite('VITE_HAMOULA_DEPLOY_ENV') ||
    'development';
  const deployEnv =
    deployRaw === 'staging' || deployRaw === 'production' ? deployRaw : 'development';

  // Production client bundles never expose debug tokens (see vite.config.ts define + appCheck/guard.ts).
  const debugToken = import.meta.env.PROD
    ? undefined
    : readVite('VITE_APP_CHECK_DEBUG_TOKEN') || undefined;

  const recaptchaRaw = readVite('VITE_APP_CHECK_RECAPTCHA_SITE_KEY');
  const recaptchaValidation = validateRecaptchaSiteKey(recaptchaRaw);
  if (recaptchaRaw && !recaptchaValidation.ok && import.meta.env.DEV) {
    console.error('[publicEnv] App Check site key invalid:', recaptchaValidation.error);
  }

  return {
    firebase: {
      apiKey: readVite('VITE_FIREBASE_API_KEY'),
      authDomain: readVite('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: readVite('VITE_FIREBASE_PROJECT_ID'),
      storageBucket: readVite('VITE_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: readVite('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: readVite('VITE_FIREBASE_APP_ID'),
      measurementId: readVite('VITE_FIREBASE_MEASUREMENT_ID') || undefined,
    },
    googleMapsApiKey:
      readVite('VITE_GOOGLE_MAPS_PLATFORM_KEY') ||
      readVite('VITE_GOOGLE_MAPS_API_KEY'),
    appCheck: {
      debugToken,
      recaptchaSiteKey: recaptchaValidation.ok
        ? recaptchaValidation.siteKey
        : normalizeRecaptchaSiteKey(recaptchaRaw),
    },
    deployEnv,
    isDevelopment: import.meta.env.DEV,
  };
}

export function getFirebaseClientConfig(): FirebaseOptions {
  const { firebase } = getClientPublicEnv();

  if (!firebase.apiKey || !firebase.projectId || !firebase.appId) {
    throw new Error(
      'Missing Firebase client env vars (VITE_FIREBASE_*). Copy .env.example → .env — see docs/ENVIRONMENT.md'
    );
  }

  assertFirebaseConfigCoherence(firebase);

  return firebase;
}

export function getGoogleMapsApiKey(): string {
  return getClientPublicEnv().googleMapsApiKey;
}

/** True when Maps should skip Firebase App Check (local Vite DEV / demos). */
export function shouldBypassMapsAppCheck(): boolean {
  return import.meta.env.DEV || !isProductionDeploy();
}

function isProductionDeploy(): boolean {
  const deploy =
    readVite('VITE_MIRAS_DEPLOY_ENV') || readVite('VITE_HAMOULA_DEPLOY_ENV');
  return deploy === 'production' || import.meta.env.PROD;
}
