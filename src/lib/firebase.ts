import '@/lib/appCheck/guard';

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { getFirebaseClientConfig } from '@/lib/publicEnv';
import { initAppCheck } from '@/lib/appCheck';
import { validateFirebaseApiKeyForAuth } from '@/lib/firebaseEnvValidation';
import {
  defaultPricingForService,
  mergePricingConfig,
  pricingDocCandidates,
  type PricingConfig,
} from '@/lib/pricingDefaults';

export type { PricingConfig };

const firebaseConfig = getFirebaseClientConfig();
const app = initializeApp(firebaseConfig);

/**
 * Device-local Auth persistence — phone OTP is remembered until explicit logout.
 *
 * Primary: `browserLocalPersistence` (localStorage) — durable on iOS Safari / Capacitor WebView.
 * Fallback: `indexedDBLocalPersistence` when localStorage is blocked (private mode, quota).
 * Never use session or in-memory persistence for client/driver phone sessions.
 */
const DEVICE_AUTH_PERSISTENCE: Persistence[] = [
  browserLocalPersistence,
  indexedDBLocalPersistence,
];

function createFirebaseAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: DEVICE_AUTH_PERSISTENCE,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createFirebaseAuth();
export const db = getFirestore(app);

/**
 * Optional local-only bypass of real reCAPTCHA (Console test/fictional numbers ONLY).
 * Real SMS requires this OFF — MALFORMED captcha errors are common when the flag is on
 * while using a live phone number or a corrupted invisible widget.
 *
 * Auto-on for hostname `localhost` (Phone Auth is blocked there anyway).
 * Keep OFF on `127.0.0.1` unless VITE_PHONE_AUTH_TESTING=true so real SMS still works.
 * NEVER enable in production builds.
 */
const isLoopbackHostname =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '[::1]');
const disableAppVerificationForTesting =
  import.meta.env.DEV &&
  (import.meta.env.VITE_PHONE_AUTH_TESTING === 'true' || isLoopbackHostname);

if (disableAppVerificationForTesting) {
  auth.settings.appVerificationDisabledForTesting = true;
  console.info(
    '[Firebase Auth] DEV: appVerificationDisabledForTesting=true (Console test phones only). ' +
      'Use 127.0.0.1 without VITE_PHONE_AUTH_TESTING for real SMS + real reCAPTCHA.'
  );
} else if (import.meta.env.DEV) {
  auth.settings.appVerificationDisabledForTesting = false;
  console.info(
    '[Firebase Auth] DEV: real reCAPTCHA enabled. Open http://127.0.0.1 (not localhost) for Phone Auth.'
  );
}

let authPersistenceReady: Promise<void> | null = null;

async function waitForAuthHydration(authInstance: Auth): Promise<void> {
  const ready = (
    authInstance as Auth & { authStateReady?: () => Promise<void> }
  ).authStateReady;
  if (typeof ready === 'function') {
    await ready.call(authInstance);
  }
}

async function ensureAuthPersistenceInternal(): Promise<void> {
  if (!authPersistenceReady) {
    authPersistenceReady = (async () => {
      const surface = Capacitor.isNativePlatform()
        ? `Capacitor ${Capacitor.getPlatform()} WebView`
        : 'browser';

      let applied = 'initializeAuth-default';
      try {
        await setPersistence(auth, browserLocalPersistence);
        applied = 'browserLocalPersistence';
      } catch (localError) {
        console.warn(
          '[Firebase Auth] browserLocalPersistence unavailable — trying IndexedDB:',
          localError
        );
        try {
          await setPersistence(auth, indexedDBLocalPersistence);
          applied = 'indexedDBLocalPersistence';
        } catch (idbError) {
          console.warn(
            '[Firebase Auth] Could not lock persistent storage. Session restore may fail on reload:',
            idbError
          );
        }
      }

      try {
        await waitForAuthHydration(auth);
      } catch (hydrateError) {
        console.warn('[Firebase Auth] authStateReady failed:', hydrateError);
      }

      console.info(
        `[Firebase Auth] persistence=${applied} (${surface}); ` +
          `currentUser=${auth.currentUser?.uid ?? 'none'}`
      );
    })().catch((error) => {
      authPersistenceReady = null;
      console.warn('[Firebase Auth] Persistence bootstrap warning:', error);
    });
  }
  return authPersistenceReady ?? Promise.resolve();
}

/**
 * Single bootstrap gate — App Check MUST initialize before Auth/Firestore traffic.
 * Started immediately on module load; all callers share the same promise.
 */
let firebaseBootstrap: Promise<void> | null = null;

function startFirebaseBootstrap(): Promise<void> {
  if (firebaseBootstrap) {
    return firebaseBootstrap;
  }

  firebaseBootstrap = (async () => {
    // Prefer a registered debug UUID from .env BEFORE initializeAppCheck (must match Console).
    if (import.meta.env.DEV) {
      const registered = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim();
      const value: string | boolean = registered || true;
      try {
        (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
          value;
        (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = value;
      } catch {
        /* ignore */
      }
      if (registered) {
        console.info(
          `[Firebase] App Check debug token prepared from .env (…${registered.slice(-6)})`
        );
      }
    }

    try {
      await initAppCheck(app);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(
          '[Firebase] App Check init failed locally (exchangeDebugToken / reCAPTCHA). ' +
            'Phone Auth will hard-fail until the debug token is registered, or set VITE_APP_CHECK_DISABLED=true with Auth App Check Unenforced:',
          err
        );
      } else {
        throw err;
      }
    }

    await ensureAuthPersistenceInternal();
  })();

  return firebaseBootstrap;
}

void startFirebaseBootstrap();

/** @deprecated Alias — prefer ensureFirebaseReady. */
export function ensureAuthPersistence(): Promise<void> {
  return ensureFirebaseReady();
}

export function ensureAppCheck(): Promise<void> {
  return ensureFirebaseReady();
}

export async function ensureFirebaseReady(): Promise<void> {
  return startFirebaseBootstrap();
}

/** Wait until Firebase Auth has restored a signed-in uid (or timeout). */
export async function waitForFirebaseAuthUid(timeoutMs = 10000): Promise<string | null> {
  try {
    await ensureFirebaseReady();
  } catch {
    /* persistence already logged */
  }
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (uid: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(uid);
    };
    const timer = setTimeout(() => finish(auth.currentUser?.uid ?? null), timeoutMs);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user?.uid) finish(user.uid);
    });
  });
}

if (import.meta.env.DEV) {
  void validateFirebaseApiKeyForAuth(firebaseConfig.apiKey, firebaseConfig.projectId).then(
    (result) => {
      if (result.ok) return;
      console.error('[firebase] API key validation failed:', result.hint);
    }
  );
}

let cachedPricing: Record<string, { data: PricingConfig; timestamp: number }> = {};
let pricingCollectionCache: { docs: Record<string, Record<string, unknown>>; timestamp: number } | null =
  null;
const CACHE_TTL = 5 * 60 * 1000;

async function loadPricingCollection(): Promise<Record<string, Record<string, unknown>>> {
  const now = Date.now();
  if (pricingCollectionCache && now - pricingCollectionCache.timestamp < CACHE_TTL) {
    return pricingCollectionCache.docs;
  }

  // List the collection (200 + empty) instead of getDoc per id (404 when missing).
  const snap = await getDocs(collection(db, 'pricing'));
  const docs: Record<string, Record<string, unknown>> = {};
  snap.forEach((row) => {
    docs[row.id] = row.data() as Record<string, unknown>;
  });
  pricingCollectionCache = { docs, timestamp: now };
  return docs;
}

export const fetchPricing = async (serviceType: string = 'flatbed'): Promise<PricingConfig> => {
  const now = Date.now();
  if (cachedPricing[serviceType] && now - cachedPricing[serviceType].timestamp < CACHE_TTL) {
    return cachedPricing[serviceType].data;
  }

  const defaults = defaultPricingForService(serviceType);

  try {
    await ensureFirebaseReady();

    const candidates = pricingDocCandidates(serviceType);
    let pricing: PricingConfig = defaults;
    let resolvedFrom: string | null = null;

    const docs = await loadPricingCollection();
    for (const docId of candidates) {
      const data = docs[docId];
      if (data) {
        pricing = mergePricingConfig(serviceType, data);
        resolvedFrom = docId;
        break;
      }
    }

    if (!resolvedFrom && import.meta.env.DEV) {
      console.info(
        `[pricing] No Firestore docs for [${candidates.join(', ')}] — using built-in defaults for "${serviceType}"`
      );
    } else if (resolvedFrom && resolvedFrom !== serviceType && import.meta.env.DEV) {
      console.info(`[pricing] pricing/${serviceType} missing — using pricing/${resolvedFrom}`);
    }

    cachedPricing[serviceType] = { data: pricing, timestamp: now };
    return pricing;
  } catch (error) {
    console.warn(`[pricing] Firestore unavailable for ${serviceType} — using built-in defaults:`, error);
    cachedPricing[serviceType] = { data: defaults, timestamp: now };
    return defaults;
  }
};
