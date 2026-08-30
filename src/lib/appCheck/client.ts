import { Capacitor } from '@capacitor/core';
import {
  CustomProvider,
  initializeAppCheck,
  getToken,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

import { getClientPublicEnv } from '@/lib/publicEnv';
import { validateRecaptchaSiteKey } from '@/lib/appCheck/config';
import {
  clearAppCheckDebugToken,
  enforceProductionAppCheckGuard,
  isAppCheckDebugModeAllowed,
  isProductionClient,
} from '@/lib/appCheck/guard';

let initPromise: Promise<void> | null = null;
let jsAppCheckInstance: AppCheck | null = null;
let initError: Error | null = null;

export class AppCheckInitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppCheckInitError';
    this.code = code;
  }
}

/**
 * When true, App Check init/token gates are skipped.
 * Honored for Vite DEV and staging/testing builds when
 * `VITE_APP_CHECK_DISABLED=true` (Auth App Check must be Unenforced in Console).
 * Never honored when `VITE_MIRAS_DEPLOY_ENV=production`.
 */
export function isAppCheckDisabled(): boolean {
  if (import.meta.env.VITE_APP_CHECK_DISABLED !== 'true') {
    return false;
  }

  const deployEnv = (
    import.meta.env.VITE_MIRAS_DEPLOY_ENV ||
    import.meta.env.VITE_HAMOULA_DEPLOY_ENV ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  // True production must never ship with App Check disabled.
  if (deployEnv === 'production') {
    return false;
  }

  return true;
}

/**
 * Phone Auth may skip App Check when explicitly disabled for local/staging testing
 * (Console Auth App Check must be unenforced, otherwise OTP still fails).
 */
export function shouldRelaxAuthAppCheck(): boolean {
  return isAppCheckDisabled();
}

export function getAppCheckInstance(): AppCheck | null {
  return jsAppCheckInstance;
}

export function getAppCheckInitError(): Error | null {
  return initError;
}

async function awaitAppCheckInit(): Promise<void> {
  if (initPromise) {
    await initPromise;
  }
}

async function initNativeAppCheck(app: FirebaseApp): Promise<void> {
  const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');

  let nativeDebugToken: string | undefined;
  if (isAppCheckDebugModeAllowed()) {
    nativeDebugToken = getClientPublicEnv().appCheck.debugToken;
  }

  await FirebaseAppCheck.initialize({
    isTokenAutoRefreshEnabled: true,
    debugToken: nativeDebugToken,
  });

  jsAppCheckInstance = initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const { token, expireTimeMillis } = await FirebaseAppCheck.getToken({
          forceRefresh: false,
        });
        return {
          token,
          expireTimeMillis: expireTimeMillis ?? Date.now() + 55 * 60 * 1000,
        };
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
}

async function initWebRecaptchaV3(app: FirebaseApp): Promise<void> {
  if (isProductionClient()) {
    enforceProductionAppCheckGuard();
  } else if (isAppCheckDebugModeAllowed()) {
    const { installDevAppCheckDebugToken } = await import('@/lib/appCheck/debug.dev');
    installDevAppCheckDebugToken();
  } else {
    clearAppCheckDebugToken();
  }

  const siteKeyRaw = getClientPublicEnv().appCheck.recaptchaSiteKey;
  const siteKeyResult = validateRecaptchaSiteKey(siteKeyRaw);
  if (!siteKeyResult.ok || !siteKeyResult.siteKey) {
    throw new AppCheckInitError(
      'APP_CHECK_SITE_KEY_REQUIRED',
      siteKeyResult.error ??
        (isProductionClient()
          ? 'Production requires VITE_APP_CHECK_RECAPTCHA_SITE_KEY.'
          : 'Set VITE_APP_CHECK_RECAPTCHA_SITE_KEY in .env (optional VITE_APP_CHECK_DEBUG_TOKEN for local dev).')
    );
  }
  const siteKey = siteKeyResult.siteKey;

  if (isProductionClient()) {
    enforceProductionAppCheckGuard();
  }

  jsAppCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  await getToken(jsAppCheckInstance, isProductionClient());

  console.info(
    isProductionClient()
      ? '[App Check] reCAPTCHA v3 active (production)'
      : '[App Check] reCAPTCHA v3 active (development)'
  );
}

function formatInitFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (isProductionClient()) {
    return (
      'App Check reCAPTCHA v3 failed on production. Verify VITE_APP_CHECK_RECAPTCHA_SITE_KEY, ' +
      'register your live domain in Firebase Console → App Check, and allow your origin on the Browser API key. ' +
      `Original error: ${raw}`
    );
  }

  if (raw.includes('403') || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_HTTP_REFERRER')) {
    return (
      'App Check blocked by API key restrictions. For localhost, allow http://localhost:* on your Browser key ' +
      'or register a debug token in Firebase Console → App Check. ' +
      `Original error: ${raw}`
    );
  }

  return `App Check initialization failed: ${raw}`;
}

/**
 * Initializes App Check once per app lifetime.
 * Web production: ReCaptchaV3Provider ONLY.
 * Web development: optional debug token + ReCaptchaV3Provider.
 * Native: Capacitor attestation bridge.
 */
export async function initAppCheck(app: FirebaseApp): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    initError = null;
    jsAppCheckInstance = null;

    // DEV always initializes App Check so FIREBASE_APPCHECK_DEBUG_TOKEN can mint/exchange a UUID.
    // Explicit VITE_APP_CHECK_DISABLED=true skips init (Phone Auth then requires Auth App Check Unenforced).
    if (isAppCheckDisabled()) {
      console.info('[App Check] Skipped (VITE_APP_CHECK_DISABLED=true)');
      return;
    }

    try {
      if (Capacitor.isNativePlatform()) {
        await initNativeAppCheck(app);
        console.info(`[App Check] Native attestation active (${Capacitor.getPlatform()})`);
        return;
      }

      await initWebRecaptchaV3(app);
    } catch (error) {
      const message = formatInitFailure(error);
      initError =
        error instanceof AppCheckInitError
          ? error
          : new AppCheckInitError('APP_CHECK_INIT_FAILED', message);
      jsAppCheckInstance = null;
      console.error('[App Check] Initialization failed:', message, error);

      // Local demos: do not throw — Maps Routes / UI must keep working without a valid debug token.
      if (import.meta.env.DEV || !isProductionClient()) {
        console.warn(
          '[App Check] Soft-failing in development. Maps will load with API key only (no App Check).'
        );
        return;
      }

      throw initError;
    }
  })();

  return initPromise;
}

export function isAppCheckActive(): boolean {
  return !isAppCheckDisabled() && jsAppCheckInstance !== null;
}

export async function ensureAppCheckTokenForAuth(): Promise<void> {
  // Explicit local bypass — only when VITE_APP_CHECK_DISABLED=true and Auth App Check is unenforced.
  if (isAppCheckDisabled()) {
    console.info(
      '[App Check] Skipped for Phone Auth (VITE_APP_CHECK_DISABLED=true). ' +
        'Auth App Check must be Unenforced in Firebase Console.'
    );
    return;
  }

  await awaitAppCheckInit();

  if (initError) {
    throw new AppCheckInitError(
      (initError as AppCheckInitError).code || 'APP_CHECK_INIT_FAILED',
      formatAuthAppCheckFailure(initError)
    );
  }

  if (!jsAppCheckInstance) {
    throw new AppCheckInitError(
      'APP_CHECK_NOT_INITIALIZED',
      import.meta.env.DEV
        ? formatAuthAppCheckFailure(
            new Error(
              'App Check did not initialize. Register VITE_APP_CHECK_DEBUG_TOKEN in Firebase Console → App Check → Manage debug tokens, or set VITE_APP_CHECK_DISABLED=true and leave Auth App Check Unenforced.'
            )
          )
        : 'App Check is not active. Set VITE_APP_CHECK_RECAPTCHA_SITE_KEY and register your production domain.'
    );
  }

  try {
    // Force a fresh token right before Phone Auth so Auth receives a valid attestation.
    await getToken(jsAppCheckInstance, true);
  } catch (error) {
    throw new AppCheckInitError('APP_CHECK_TOKEN_EXCHANGE_FAILED', formatAuthAppCheckFailure(error));
  }
}

function formatAuthAppCheckFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const debugToken = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim();
  const tokenHint = debugToken
    ? `Current VITE_APP_CHECK_DEBUG_TOKEN ends with …${debugToken.slice(-6)}. Register this exact UUID in Firebase Console → App Check → Manage debug tokens, then restart npm run dev.`
    : 'Set VITE_APP_CHECK_DEBUG_TOKEN in .env to a UUID registered under App Check → Manage debug tokens (or leave empty, copy the UUID printed in the console, register it, then set it).';

  if (import.meta.env.DEV) {
    return (
      `App Check blocked Phone Auth on localhost. ${tokenHint} ` +
      `Alternative: set VITE_APP_CHECK_DISABLED=true and set Authentication App Check to Unenforced. ` +
      `Original error: ${raw}`
    );
  }

  return formatInitFailure(error);
}

export async function getAppCheckToken(forceRefresh = false): Promise<string | null> {
  if (isAppCheckDisabled()) {
    return null;
  }

  await awaitAppCheckInit();

  if (initError || !jsAppCheckInstance) {
    return null;
  }

  try {
    const result = await getToken(jsAppCheckInstance, forceRefresh);
    return result.token;
  } catch {
    return null;
  }
}

/** Strict gate for secured server APIs — always sends token when App Check is enabled. */
export async function ensureAppCheckTokenForApi(forceRefresh = false): Promise<string | null> {
  if (isAppCheckDisabled()) {
    return null;
  }

  await awaitAppCheckInit();

  // Localhost demos: never throw on exchangeDebugToken 403 — callers proceed without the header.
  if (import.meta.env.DEV) {
    if (initError || !jsAppCheckInstance) {
      return null;
    }
    try {
      const result = await getToken(jsAppCheckInstance, forceRefresh);
      return result.token;
    } catch (error) {
      console.warn('[App Check] API token soft-fail (dev):', error);
      return null;
    }
  }

  if (initError) {
    throw initError;
  }
  if (!jsAppCheckInstance) {
    throw new AppCheckInitError(
      'APP_CHECK_NOT_INITIALIZED',
      isProductionClient()
        ? 'App Check is not active. Set VITE_APP_CHECK_RECAPTCHA_SITE_KEY and register your production domain.'
        : 'App Check is not configured for this build.'
    );
  }

  try {
    const result = await getToken(jsAppCheckInstance, forceRefresh);
    return result.token;
  } catch (error) {
    throw new AppCheckInitError('APP_CHECK_TOKEN_EXCHANGE_FAILED', formatInitFailure(error));
  }
}
