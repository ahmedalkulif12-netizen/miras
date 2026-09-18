/**
 * Native iOS Phone Auth via CapacitorFirebaseAuthentication.
 *
 * The Firebase JS RecaptchaVerifier cannot run inside capacitor:// WebViews and
 * returns auth/internal-error. Native verifyPhoneNumber uses APNs or an
 * SFSafariViewController reCAPTCHA — never the WebView widget.
 *
 * skipNativeAuth stays true so Firestore / Auth keep using the JS SDK session.
 *
 * UI must not wait for `phoneCodeSent`. signInWithPhoneNumber resolves as soon as
 * native verifyPhoneNumber *starts*; the verificationId arrives later. Confirm()
 * waits for that id so Send OTP can navigate immediately.
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
import { shouldUseNativeIosPhoneAuth as matchNativeIosPhoneAuth } from '@/lib/nativePhoneAuthRuntime';
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';

const NATIVE_PLUGIN_START_TIMEOUT_MS = 8_000;
const NATIVE_VERIFY_TIMEOUT_MS = 35_000;

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
  return matchNativeIosPhoneAuth({ isNative, platform, protocol });
}

type PluginListenerHandle = { remove: () => Promise<void> };

type NativeAuthPlugin = {
  signInWithPhoneNumber: (options: {
    phoneNumber: string;
    skipNativeAuth?: boolean;
    timeout?: number;
  }) => Promise<unknown>;
  addListener: (
    event: string,
    callback: (event: { verificationId?: string; message?: string }) => void
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
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  if (/invalid.?phone/i.test(message) || code.includes('invalid-phone')) {
    return Object.assign(new Error('auth/invalid-phone-number'), {
      code: 'auth/invalid-phone-number',
    });
  }
  if (/too many/i.test(message) || code.includes('too-many-requests')) {
    return Object.assign(new Error('auth/too-many-requests'), {
      code: 'auth/too-many-requests',
    });
  }
  if (/quota/i.test(message) || code.includes('quota')) {
    return Object.assign(new Error('auth/quota-exceeded'), {
      code: 'auth/quota-exceeded',
    });
  }
  return Object.assign(new Error(message || 'auth/internal-error'), {
    code: code || 'auth/internal-error',
  });
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
 * Starts native iOS verifyPhoneNumber and returns immediately after the plugin
 * call is accepted. SMS / APNs / Safari reCAPTCHA continue in the background.
 * Confirm() waits for the verificationId.
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
        Object.assign(new Error('OTP_SEND_TIMEOUT'), { code: 'OTP_SEND_TIMEOUT' })
      );
    }, NATIVE_VERIFY_TIMEOUT_MS);
  });
  void verificationIdPromise.catch(() => undefined);

  try {
    await withTimeout(
      (async () => {
        const failed = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
            settleVerification(
              false,
              Object.assign(new Error(event.message || 'auth/internal-error'), {
                code: 'auth/internal-error',
              })
            );
          })
        );
        const sent = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
            const id = readVerificationId(event);
            if (id) {
              logPhoneAuth('Verification ID Received', id);
              settleVerification(true, id);
            }
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
  } catch (error) {
    if (isNativePhoneAuthUnavailable(error)) {
      throw Object.assign(new Error('NATIVE_PHONE_AUTH_UNAVAILABLE'), {
        code: 'NATIVE_PHONE_AUTH_UNAVAILABLE',
      });
    }
    throw error;
  }

  logPhoneAuth('Init', 'native verifyPhoneNumber started — UI may navigate to OTP');
  return makeJsConfirmation();
}

export function getNativePhoneVerificationId(): string | null {
  return nativeVerificationId;
}
