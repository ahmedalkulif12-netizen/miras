/**
 * Firebase Phone Auth.
 *
 * Web: invisible RecaptchaVerifier + signInWithPhoneNumber.
 * iOS Capacitor: CapacitorFirebaseAuthentication native verifyPhoneNumber, then
 * JS signInWithCredential so Firestore keeps the web Auth session.
 *
 * SMS is sent at most once per in-flight request for a given E.164 number
 * (double-clicks / React Strict Mode coalesce; different numbers wait then send once).
 */
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth, ensureFirebaseReady } from '@/lib/firebase';
import {
  ensureAppCheckTokenForAuth,
  isAppCheckAttestationFailure,
  isAppCheckDisabled,
  isNativeCapacitorRuntime,
  shouldRelaxAuthAppCheck,
} from '@/lib/appCheck';
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';
import { getPhoneAuthErrorCode } from '@/lib/phoneAuthErrors';
import { buildCaptchaHostnameHint, getBrowserHostname } from '@/lib/phoneAuthDomains';
import { getClientPublicEnv } from '@/lib/publicEnv';
import {
  logPhoneAuth,
  resetNativePhoneAuth,
  sendNativeIosPhoneOtp,
  shouldUseNativeIosPhoneAuth,
  isNativePhoneAuthUnavailable,
} from '@/lib/nativePhoneAuth';

export const PHONE_AUTH_RECAPTCHA_CONTAINER_ID = 'miras-recaptcha';

/** Prevents hung App Check / Firebase SMS from locking the login UI forever. */
const OTP_SEND_TIMEOUT_MS = 45_000;
/** Native iOS waits for Firebase verificationId (real SMS request). */
const OTP_SEND_NATIVE_TIMEOUT_MS = 95_000;
const OTP_CONFIRM_TIMEOUT_MS = 45_000;
const OTP_CONFIRM_NATIVE_TIMEOUT_MS = 90_000;

type WindowWithRecaptcha = Window & {
  __mirasRecaptchaVerifier?: RecaptchaVerifier;
};

let recaptchaVerifier: RecaptchaVerifier | null = null;
let activeConfirmation: ConfirmationResult | null = null;
let sendInFlight: { phoneE164: string; promise: Promise<string> } | null = null;
let confirmInFlight: { code: string; promise: Promise<User> } | null = null;

function preserveAuthError(error: unknown): Error & { code?: string } {
  if (error instanceof Error) {
    return error as Error & { code?: string };
  }
  return Object.assign(new Error('PHONE_AUTH_FAILED'), {
    code: 'auth/internal-error',
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(Object.assign(new Error(code), { code }));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isExpiredOtpError(code: string): boolean {
  return (
    code === 'auth/code-expired' ||
    code === 'auth/session-expired' ||
    code === 'auth/invalid-verification-id' ||
    code === 'NO_OTP_SESSION'
  );
}

/**
 * Off-screen but still "visible" to the browser layout engine.
 * Do NOT use opacity:0 / visibility:hidden / pointer-events:none — those cause
 * Recaptcha verification failed - MALFORMED.
 */
function placeContainerOffscreen(container: HTMLElement): void {
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1px',
    height: '1px',
    margin: '0',
    padding: '0',
    overflow: 'hidden',
    border: '0',
    opacity: '1',
    visibility: 'visible',
    pointerEvents: 'auto',
    zIndex: '0',
  });
}

/**
 * Persistent reCAPTCHA mount on document.body (survives React step transitions).
 */
export function ensurePersistentRecaptchaContainer(
  containerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID
): HTMLElement {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  } else if (!container.isConnected) {
    document.body.appendChild(container);
  }
  placeContainerOffscreen(container);
  return container;
}

async function clearRecaptchaVerifier(): Promise<void> {
  const existing = recaptchaVerifier ?? (window as WindowWithRecaptcha).__mirasRecaptchaVerifier;
  recaptchaVerifier = null;
  delete (window as WindowWithRecaptcha).__mirasRecaptchaVerifier;

  if (existing) {
    try {
      existing.clear();
    } catch {
      /* already cleared */
    }
  }

  const container = document.getElementById(PHONE_AUTH_RECAPTCHA_CONTAINER_ID);
  if (container) {
    container.replaceChildren();
    placeContainerOffscreen(container);
  }
}

/**
 * Creates a fresh invisible RecaptchaVerifier on a clean container.
 * Uses the container element id string (Firebase docs pattern).
 */
async function createInvisibleVerifier(
  containerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID
): Promise<RecaptchaVerifier> {
  await clearRecaptchaVerifier();
  ensurePersistentRecaptchaContainer(containerId);

  const verifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      /* solved — signInWithPhoneNumber continues */
    },
    'expired-callback': () => {
      void clearRecaptchaVerifier();
    },
  });

  // Pre-render so the widget is ready; do not restyle/hide iframes after this.
  await verifier.render();
  recaptchaVerifier = verifier;
  (window as WindowWithRecaptcha).__mirasRecaptchaVerifier = verifier;
  return verifier;
}

/** Call after OTP SMS succeeds — keep session flags; do not destroy the widget mid-flow. */
export function stabilizeRecaptchaForOtpEntry(
  _containerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID
): void {
  /* no-op for layout; kept for call-site compatibility */
}

export async function resetRecaptchaVerifier(
  _recaptchaContainerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
  _options?: { force?: boolean }
): Promise<void> {
  await clearRecaptchaVerifier();
  ensurePersistentRecaptchaContainer(PHONE_AUTH_RECAPTCHA_CONTAINER_ID);
}

export async function resetPhoneAuthFlow(): Promise<void> {
  activeConfirmation = null;
  confirmInFlight = null;
  await resetNativePhoneAuth();
  if (shouldUseNativeIosPhoneAuth()) {
    return;
  }
  await clearRecaptchaVerifier();
  ensurePersistentRecaptchaContainer();
}

export async function preparePhoneAuthRecaptcha(
  recaptchaContainerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
  _options?: { forceNew?: boolean }
): Promise<RecaptchaVerifier> {
  return createInvisibleVerifier(recaptchaContainerId);
}

export function isPhoneAuthRecaptchaReady(): boolean {
  return (
    recaptchaVerifier !== null &&
    document.getElementById(PHONE_AUTH_RECAPTCHA_CONTAINER_ID)?.isConnected === true
  );
}

async function sendPhoneOtpOnce(
  phoneE164: string,
  recaptchaContainerId: string
): Promise<string> {
  const useNativeIos = shouldUseNativeIosPhoneAuth();

  // Firebase Auth policy: hostname "localhost" is not allowed for Phone Auth.
  // Native iOS uses CapacitorFirebaseAuthentication and never hits this WebView host check.
  if (!useNativeIos && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '[::1]') {
      throw Object.assign(
        new Error(
          'Phone Auth is blocked on hostname "localhost". Open http://127.0.0.1:' +
            (window.location.port || '3000') +
            '/login and add 127.0.0.1 under Firebase Console → Authentication → Settings → Authorized domains.'
        ),
        { code: 'PHONE_AUTH_LOCALHOST_BLOCKED' }
      );
    }
  }

  // Staging/testing may set VITE_APP_CHECK_DISABLED=true (see isAppCheckDisabled).
  // True production deployEnv still requires App Check.
  if (getClientPublicEnv().deployEnv === 'production' && isAppCheckDisabled()) {
    throw Object.assign(new Error('APP_CHECK_REQUIRED_IN_PRODUCTION'), {
      code: 'APP_CHECK_REQUIRED_IN_PRODUCTION',
    });
  }

  if (useNativeIos) {
    void ensureFirebaseReady().catch((error) => {
      console.warn('[PhoneAuth] Init: Firebase bootstrap still pending — continuing native OTP', error);
    });
    try {
      activeConfirmation = await sendNativeIosPhoneOtp(phoneE164);
      logPhoneAuth('Verification ID Received');
      return phoneE164;
    } catch (error) {
      const authError = preserveAuthError(error);
      if (isNativePhoneAuthUnavailable(authError)) {
        console.warn(
          '[PhoneAuth] Init: native CapacitorFirebaseAuthentication missing — falling back to JS Phone Auth'
        );
        // Fall through to RecaptchaVerifier so login is not blocked by a red guard.
      } else if (isAppCheckAttestationFailure(authError)) {
        throw Object.assign(
          new Error(
            'Phone verification was blocked by App Check on this device. ' +
              'Register the iOS app in Firebase Console → App Check (App Attest / DeviceCheck) ' +
              'or set Authentication App Check to Monitor until TestFlight attestation works.'
          ),
          { code: 'auth/failed-precondition' }
        );
      } else {
        throw authError;
      }
    }
  }

  if (!shouldRelaxAuthAppCheck()) {
    await ensureFirebaseReady();
    try {
      await ensureAppCheckTokenForAuth();
    } catch (error) {
      // TestFlight / Play Integrity gaps must not block real SMS OTP.
      if (isNativeCapacitorRuntime()) {
        console.warn(
          '[phoneAuth] App Check token unavailable — continuing Phone OTP without attestation:',
          error
        );
      } else {
        throw error;
      }
    }
  } else {
    await ensureFirebaseReady();
  }

  const verifier = await createInvisibleVerifier(recaptchaContainerId);
  try {
    activeConfirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (error) {
    const code = getPhoneAuthErrorCode(error);
    const message = error instanceof Error ? error.message : '';
    if (
      code === 'auth/captcha-check-failed' ||
      /Hostname match not found/i.test(message)
    ) {
      const projectId = getClientPublicEnv().firebase.projectId || 'hamula-cfc6c';
      throw Object.assign(
        new Error(buildCaptchaHostnameHint(getBrowserHostname(), projectId)),
        { code: 'auth/captcha-check-failed' }
      );
    }
    if (isNativeCapacitorRuntime() && isAppCheckAttestationFailure(error)) {
      console.warn(
        '[phoneAuth] Firebase Auth rejected App Check on native:',
        error
      );
      throw Object.assign(
        new Error(
          'Phone verification was blocked by App Check on this device. ' +
            'Register the iOS app in Firebase Console → App Check (App Attest / DeviceCheck) ' +
            'or set Authentication App Check to Monitor until TestFlight attestation works.'
        ),
        { code: 'auth/failed-precondition' }
      );
    }
    throw preserveAuthError(error);
  }
  return phoneE164;
}

/**
 * Sends SMS OTP via Firebase Phone Auth (Admin, Customer, Driver share this path).
 * Exactly one SMS per successful call; concurrent identical requests share one send.
 * Refuses to send when a Firebase Auth session is already active (must logout first).
 */
export async function sendPhoneOtp(
  rawPhone: string,
  recaptchaContainerId = PHONE_AUTH_RECAPTCHA_CONTAINER_ID
): Promise<string> {
  logPhoneAuth('Init');
  let phoneE164: string;
  try {
    phoneE164 = toFirebasePhoneE164(rawPhone);
    logPhoneAuth('E164 Formatted', phoneE164);
  } catch (error) {
    throw preserveAuthError(error);
  }

  if (auth.currentUser) {
    throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
      code: 'ALREADY_AUTHENTICATED',
    });
  }

  // Double-submit / Strict Mode: coalesce only for the same number.
  if (sendInFlight?.phoneE164 === phoneE164) {
    return sendInFlight.promise;
  }

  // Different number while a send is running — wait it out, then send once for the new number.
  if (sendInFlight) {
    try {
      await sendInFlight.promise;
    } catch {
      /* previous send failed — proceed with a single new attempt */
    }
  }

  if (auth.currentUser) {
    throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
      code: 'ALREADY_AUTHENTICATED',
    });
  }

  const promise = (async () => {
    try {
      return await withTimeout(
        sendPhoneOtpOnce(phoneE164, recaptchaContainerId),
        shouldUseNativeIosPhoneAuth() ? OTP_SEND_NATIVE_TIMEOUT_MS : OTP_SEND_TIMEOUT_MS,
        'OTP_SEND_TIMEOUT'
      );
    } catch (error) {
      activeConfirmation = null;
      const authError = preserveAuthError(error);
      console.error('[phoneAuth] sendPhoneOtp failed:', getPhoneAuthErrorCode(authError), authError);
      if (shouldUseNativeIosPhoneAuth()) {
        await resetNativePhoneAuth();
      } else {
        await clearRecaptchaVerifier();
        ensurePersistentRecaptchaContainer(recaptchaContainerId);
      }
      throw authError;
    }
  })();

  sendInFlight = { phoneE164, promise };

  try {
    return await promise;
  } finally {
    if (sendInFlight?.promise === promise) {
      sendInFlight = null;
    }
  }
}

export async function confirmPhoneOtp(otp: string): Promise<User> {
  await ensureFirebaseReady();
  const code = otp.replace(/\D/g, '');
  if (code.length < 6) {
    throw Object.assign(new Error('auth/invalid-verification-code'), {
      code: 'auth/invalid-verification-code',
    });
  }

  if (!activeConfirmation) {
    throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
  }

  // Coalesce duplicate confirm submissions of the same code (double-click).
  if (confirmInFlight?.code === code) {
    return confirmInFlight.promise;
  }

  if (confirmInFlight) {
    try {
      await confirmInFlight.promise;
    } catch {
      /* previous confirm failed — allow a new attempt */
    }
  }

  if (!activeConfirmation) {
    throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
  }

  const confirmation = activeConfirmation;
  const promise = (async () => {
    try {
      const credential = await withTimeout(
        confirmation.confirm(code),
        shouldUseNativeIosPhoneAuth() ? OTP_CONFIRM_NATIVE_TIMEOUT_MS : OTP_CONFIRM_TIMEOUT_MS,
        'OTP_CONFIRM_TIMEOUT'
      );
      activeConfirmation = null;
      await clearRecaptchaVerifier();
      await resetNativePhoneAuth();
      try {
        await credential.user.getIdToken(true);
      } catch (error) {
        console.warn('[phoneAuth] ID token persist after OTP confirm:', error);
        await credential.user.getIdToken(false).catch(() => undefined);
      }
      return credential.user;
    } catch (error) {
      const authError = preserveAuthError(error);
      const errCode = getPhoneAuthErrorCode(authError);
      console.error('[phoneAuth] confirmPhoneOtp failed:', errCode, authError);
      // Expired / invalid session — clear so UI must request a fresh SMS (no hanging retries).
      if (isExpiredOtpError(errCode) || errCode === 'OTP_CONFIRM_TIMEOUT') {
        activeConfirmation = null;
        await clearRecaptchaVerifier();
        await resetNativePhoneAuth();
      }
      throw authError;
    }
  })();

  confirmInFlight = { code, promise };

  try {
    return await promise;
  } finally {
    if (confirmInFlight?.promise === promise) {
      confirmInFlight = null;
    }
  }
}

export function hasActivePhoneOtpSession(): boolean {
  return activeConfirmation !== null;
}

export { isExpiredOtpError };
