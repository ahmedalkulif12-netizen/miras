/**
 * Native Capacitor Phone Auth via CapacitorFirebaseAuthentication (iOS + Android).
 *
 * skipNativeAuth stays true so Firestore / Auth keep using the JS SDK session.
 * Send OTP waits for phoneCodeSent (verificationId) so the OTP screen only
 * opens after Firebase actually accepts the request.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  PhoneAuthProvider,
  signInWithCredential,
  type ConfirmationResult,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { isNativeCapacitorRuntime } from '@/lib/appCheck';
import { shouldUseNativePhoneAuth as matchNativePhoneAuth } from '@/lib/nativePhoneAuthRuntime';
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';

const NATIVE_PLUGIN_START_TIMEOUT_MS = 8_000;
/** Wait for Firebase to accept verifyPhoneNumber and return verificationId. */
const NATIVE_VERIFY_TIMEOUT_MS = 90_000;

export function logPhoneAuth(step: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.info(`[PhoneAuth] ${step}`, extra);
  } else {
    console.info(`[PhoneAuth] ${step}`);
  }
}

export function shouldUseNativeIosPhoneAuth(runtime?: {
  isNative?: boolean;
  platform?: string;
  protocol?: string;
}): boolean {
  const isNative =
    runtime?.isNative ??
    (() => {
      try {
        return isNativeCapacitorRuntime();
      } catch {
        return false;
      }
    })();
  const platform =
    runtime?.platform ??
    (() => {
      try {
        return Capacitor.getPlatform();
      } catch {
        return 'web';
      }
    })();
  const protocol =
    runtime?.protocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  return matchNativePhoneAuth({ isNative, platform, protocol });
}

export const shouldUseNativePhoneAuth = shouldUseNativeIosPhoneAuth;

type PluginListenerHandle = { remove: () => Promise<void> };

type NativeAuthPlugin = {
  signInWithPhoneNumber: (options: {
    phoneNumber: string;
    skipNativeAuth?: boolean;
    timeout?: number;
  }) => Promise<unknown>;
  addListener: (
    event: string,
    callback: (event: { verificationId?: string; message?: string; code?: string }) => void
  ) => Promise<PluginListenerHandle> | PluginListenerHandle;
};

let nativeVerificationId: string | null = null;
let verificationIdPromise: Promise<string> | null = null;
let listeners: PluginListenerHandle[] = [];

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

function pluginLooksUsable(plugin: unknown): plugin is NativeAuthPlugin {
  return (
    !!plugin &&
    typeof plugin === 'object' &&
    typeof (plugin as NativeAuthPlugin).signInWithPhoneNumber === 'function' &&
    typeof (plugin as NativeAuthPlugin).addListener === 'function'
  );
}

export function isNativePhoneAuthUnavailable(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'NATIVE_PHONE_AUTH_UNAVAILABLE' ||
    code === 'UNIMPLEMENTED' ||
    /UNIMPLEMENTED/i.test(code) ||
    /not implemented/i.test(message) ||
    /plugin is not implemented/i.test(message) ||
    /NATIVE_PHONE_AUTH_UNAVAILABLE/i.test(message)
  );
}

/**
 * Static import so Vite always ships the plugin JS with the Capacitor bundle.
 * Dynamic import() was split into a separate chunk that 404s inside capacitor://.
 */
function getNativeAuthPlugin(): NativeAuthPlugin | null {
  try {
    if (pluginLooksUsable(FirebaseAuthentication)) {
      return FirebaseAuthentication as unknown as NativeAuthPlugin;
    }
  } catch (error) {
    console.warn('[PhoneAuth] Init: package FirebaseAuthentication unavailable', error);
  }
  try {
    const registered = registerPlugin<NativeAuthPlugin>('FirebaseAuthentication');
    if (pluginLooksUsable(registered)) {
      return registered;
    }
  } catch (error) {
    console.warn('[PhoneAuth] Init: registerPlugin(FirebaseAuthentication) failed', error);
  }
  return null;
}

function clearNativeListeners(): void {
  const current = listeners;
  listeners = [];
  void Promise.all(current.map((handle) => handle.remove().catch(() => undefined)));
}

export async function resetNativePhoneAuth(): Promise<void> {
  nativeVerificationId = null;
  verificationIdPromise = null;
  clearNativeListeners();
}

function nativeAuthError(error: unknown): Error & { code?: string } {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : 'auth/internal-error';
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const mapped = mapNativeAuthCode(rawCode, message);
  return Object.assign(new Error(message || mapped), { code: mapped });
}

function mapNativeAuthCode(code: string, message: string): string {
  const lower = `${code} ${message}`.toLowerCase();
  if (code.startsWith('auth/')) return code;
  if (/invalid.?phone/i.test(lower) || code.endsWith('17042')) return 'auth/invalid-phone-number';
  if (/too.?many/i.test(lower) || code.endsWith('17010')) return 'auth/too-many-requests';
  if (/quota/i.test(lower) || code.endsWith('17052')) return 'auth/quota-exceeded';
  if (/app-not-authorized|not authorized/i.test(lower) || code.endsWith('17028')) {
    return 'auth/app-not-authorized';
  }
  if (/missing-apns|missing.?app.?token/i.test(lower) || code.endsWith('17048')) {
    return 'auth/missing-apns-token';
  }
  if (/app-not-verified/i.test(lower) || code.endsWith('17050')) return 'auth/app-not-verified';
  if (/operation-not-allowed/i.test(lower)) return 'auth/operation-not-allowed';
  if (/invalid.?api.?key/i.test(lower)) return 'auth/invalid-api-key';
  return code || 'auth/internal-error';
}

function readVerificationId(event: { verificationId?: string } | null | undefined): string {
  const id = event && typeof event === 'object' ? String(event.verificationId || '').trim() : '';
  return id;
}

function makeJsConfirmation(): ConfirmationResult {
  return {
    get verificationId() {
      return nativeVerificationId || '';
    },
    confirm: async (verificationCode: string): Promise<UserCredential> => {
      const verificationId = await waitForNativeVerificationId();
      const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
      return signInWithCredential(auth, credential);
    },
  } as ConfirmationResult;
}

export async function waitForNativeVerificationId(): Promise<string> {
  if (nativeVerificationId) {
    return nativeVerificationId;
  }
  if (!verificationIdPromise) {
    throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
  }
  return verificationIdPromise;
}

/**
 * Triggers native Firebase Phone Auth and waits for verificationId (SMS request accepted).
 */
export async function sendNativeIosPhoneOtp(phoneInput: string): Promise<ConfirmationResult> {
  logPhoneAuth('Init');
  const phoneE164 = toFirebasePhoneE164(phoneInput);
  logPhoneAuth('E164 Formatted', phoneE164);

  const plugin = getNativeAuthPlugin();
  if (!plugin) {
    throw Object.assign(new Error('NATIVE_PHONE_AUTH_UNAVAILABLE'), {
      code: 'NATIVE_PHONE_AUTH_UNAVAILABLE',
    });
  }
  const FirebaseAuthentication = plugin;

  clearNativeListeners();
  nativeVerificationId = null;

  let settleVerification: (ok: boolean, value: string | unknown) => void = () => undefined;

  verificationIdPromise = new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer = 0;
    settleVerification = (ok, value) => {
      if (settled) return;
      settled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      if (ok) {
        nativeVerificationId = String(value);
        resolve(String(value));
      } else {
        reject(nativeAuthError(value));
      }
    };
    timer = window.setTimeout(() => {
      settleVerification(
        false,
        Object.assign(
          new Error('OTP_SEND_TIMEOUT: Firebase did not dispatch SMS'),
          { code: 'OTP_SEND_TIMEOUT' }
        )
      );
    }, NATIVE_VERIFY_TIMEOUT_MS);
  });

  try {
    await withTimeout(
      (async () => {
        const failed = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
            const err = Object.assign(new Error(event.message || 'auth/internal-error'), {
              code: event.code || 'auth/internal-error',
            });
            logPhoneAuth(`Error: ${err.code} ${err.message}`);
            settleVerification(false, err);
          })
        );
        const sent = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
            const id = readVerificationId(event);
            if (!id) {
              logPhoneAuth('Error: EMPTY_VERIFICATION_ID SMS was not dispatched');
              settleVerification(
                false,
                Object.assign(new Error('EMPTY_VERIFICATION_ID'), {
                  code: 'EMPTY_VERIFICATION_ID',
                })
              );
              return;
            }
            logPhoneAuth('Verification ID Received', id);
            settleVerification(true, id);
          })
        );
        const completed = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneVerificationCompleted', (event) => {
            const id = readVerificationId(event);
            if (id) {
              logPhoneAuth('Verification ID Received', id);
              settleVerification(true, id);
            }
          })
        );
        listeners = [failed, sent, completed];

        logPhoneAuth('Verification Request Sent', phoneE164);
        await Promise.resolve(
          FirebaseAuthentication.signInWithPhoneNumber({
            phoneNumber: phoneE164,
            skipNativeAuth: true,
          })
        );
      })(),
      NATIVE_PLUGIN_START_TIMEOUT_MS,
      'OTP_SEND_TIMEOUT'
    );

    const verificationId = await verificationIdPromise;
    if (!verificationId) {
      throw Object.assign(new Error('EMPTY_VERIFICATION_ID'), {
        code: 'EMPTY_VERIFICATION_ID',
      });
    }
  } catch (error) {
    settleVerification(false, error);
    void verificationIdPromise.catch(() => undefined);
    logPhoneAuth(
      `Error: ${error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''} ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (isNativePhoneAuthUnavailable(error)) {
      throw Object.assign(new Error('NATIVE_PHONE_AUTH_UNAVAILABLE'), {
        code: 'NATIVE_PHONE_AUTH_UNAVAILABLE',
      });
    }
    throw error;
  }

  return makeJsConfirmation();
}

export function getNativePhoneVerificationId(): string | null {
  return nativeVerificationId;
}
