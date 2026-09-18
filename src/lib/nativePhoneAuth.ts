/**
 * Native iOS Phone Auth via CapacitorFirebaseAuthentication.
 *
 * The Firebase JS RecaptchaVerifier cannot run inside capacitor:// WebViews and
 * returns auth/internal-error. Native verifyPhoneNumber uses APNs or an
 * SFSafariViewController reCAPTCHA — never the WebView widget.
 *
 * skipNativeAuth stays true so Firestore / Auth keep using the JS SDK session.
 *
 * signInWithPhoneNumber is fire-and-forget: the iOS plugin resolves as soon as
 * PhoneAuthProvider.verifyPhoneNumber is *started*. The SMS verificationId
 * arrives later on `phoneCodeSent`. Awaiting the plugin call (or App Check)
 * must never block that event.
 */
import { Capacitor } from '@capacitor/core';
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
let listeners: PluginListenerHandle[] = [];

async function getNativeAuthPlugin(): Promise<NativeAuthPlugin> {
  const mod = await import('@capacitor-firebase/authentication');
  const plugin = (mod as { FirebaseAuthentication?: NativeAuthPlugin }).FirebaseAuthentication;
  if (!plugin?.signInWithPhoneNumber) {
    throw Object.assign(new Error('NATIVE_PHONE_AUTH_UNAVAILABLE'), {
      code: 'NATIVE_PHONE_AUTH_UNAVAILABLE',
    });
  }
  return plugin;
}

async function clearNativeListeners(): Promise<void> {
  const current = listeners;
  listeners = [];
  await Promise.all(current.map((handle) => handle.remove().catch(() => undefined)));
}

export async function resetNativePhoneAuth(): Promise<void> {
  nativeVerificationId = null;
  await clearNativeListeners();
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

function makeJsConfirmation(verificationId: string): ConfirmationResult {
  return {
    verificationId,
    confirm: async (verificationCode: string): Promise<UserCredential> => {
      const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
      return signInWithCredential(auth, credential);
    },
  } as ConfirmationResult;
}

function readVerificationId(event: { verificationId?: string } | null | undefined): string {
  const id = event && typeof event === 'object' ? String(event.verificationId || '').trim() : '';
  return id;
}

/**
 * Sends SMS via the native iOS Firebase Auth SDK, then returns a JS
 * ConfirmationResult so the rest of the app keeps using firebase/auth.
 */
export async function sendNativeIosPhoneOtp(phoneInput: string): Promise<ConfirmationResult> {
  logPhoneAuth('Init');
  const phoneE164 = toFirebasePhoneE164(phoneInput);
  logPhoneAuth('E164 Formatted', phoneE164);

  const FirebaseAuthentication = await getNativeAuthPlugin();
  await clearNativeListeners();
  nativeVerificationId = null;

  const verificationId = await new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer = 0;

    const finish = (ok: boolean, value: string | unknown) => {
      if (settled) return;
      settled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      if (ok) {
        resolve(String(value));
      } else {
        reject(nativeAuthError(value));
      }
    };

    timer = window.setTimeout(() => {
      finish(
        false,
        Object.assign(new Error('OTP_SEND_TIMEOUT'), { code: 'OTP_SEND_TIMEOUT' })
      );
    }, NATIVE_VERIFY_TIMEOUT_MS);

    void (async () => {
      try {
        const failed = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
            finish(
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
              finish(true, id);
            }
          })
        );
        const completed = await Promise.resolve(
          FirebaseAuthentication.addListener('phoneVerificationCompleted', (event) => {
            const id = readVerificationId(event);
            if (id) {
              logPhoneAuth('Verification ID Received', id);
              finish(true, id);
            }
          })
        );
        listeners = [failed, sent, completed];

        // Native plugin call.resolve() happens when verifyPhoneNumber *starts*,
        // not when the SMS is sent. Never await it as a UI gate.
        const started = Promise.resolve(
          FirebaseAuthentication.signInWithPhoneNumber({
            phoneNumber: phoneE164,
            skipNativeAuth: true,
          })
        );
        void started.then(
          () => {
            logPhoneAuth('Init', 'native verifyPhoneNumber started');
          },
          (error) => {
            finish(false, error);
          }
        );
      } catch (error) {
        finish(false, error);
      }
    })();
  });

  nativeVerificationId = verificationId;
  return makeJsConfirmation(verificationId);
}

export function getNativePhoneVerificationId(): string | null {
  return nativeVerificationId;
}
