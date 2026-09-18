/**
 * Native iOS Phone Auth via CapacitorFirebaseAuthentication.
 *
 * The Firebase JS RecaptchaVerifier cannot run inside capacitor:// WebViews and
 * returns auth/internal-error. Native verifyPhoneNumber uses APNs or an
 * SFSafariViewController reCAPTCHA — never the WebView widget.
 *
 * skipNativeAuth stays true so Firestore / Auth keep using the JS SDK session.
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

export function shouldUseNativeIosPhoneAuth(runtime?: {
  isNative?: boolean;
  platform?: string;
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
  return matchNativeIosPhoneAuth({ isNative, platform });
}

type PluginListenerHandle = { remove: () => Promise<void> };

let nativeVerificationId: string | null = null;
let listeners: PluginListenerHandle[] = [];

async function getNativeAuthPlugin() {
  const mod = await import('@capacitor-firebase/authentication');
  if (!mod?.FirebaseAuthentication?.signInWithPhoneNumber) {
    throw Object.assign(new Error('NATIVE_PHONE_AUTH_UNAVAILABLE'), {
      code: 'NATIVE_PHONE_AUTH_UNAVAILABLE',
    });
  }
  return mod.FirebaseAuthentication;
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

/**
 * Sends SMS via the native iOS Firebase Auth SDK, then returns a JS
 * ConfirmationResult so the rest of the app keeps using firebase/auth.
 */
export async function sendNativeIosPhoneOtp(phoneE164: string): Promise<ConfirmationResult> {
  const FirebaseAuthentication = await getNativeAuthPlugin();
  await clearNativeListeners();
  nativeVerificationId = null;

  const verificationId = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const settleOk = (id: string) => {
      if (settled) return;
      settled = true;
      resolve(id);
    };
    const settleErr = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(nativeAuthError(error));
    };

    void (async () => {
      try {
        const failed = await FirebaseAuthentication.addListener(
          'phoneVerificationFailed',
          (event) => {
            settleErr(
              Object.assign(new Error(event.message || 'auth/internal-error'), {
                code: 'auth/internal-error',
              })
            );
          }
        );
        const sent = await FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
          if (event.verificationId) {
            settleOk(event.verificationId);
          }
        });
        const completed = await FirebaseAuthentication.addListener(
          'phoneVerificationCompleted',
          (event) => {
            const id =
              event && typeof event === 'object' && 'verificationId' in event
                ? String((event as { verificationId?: string }).verificationId || '')
                : '';
            if (id) settleOk(id);
          }
        );
        listeners = [failed, sent, completed];
        await FirebaseAuthentication.signInWithPhoneNumber({
          phoneNumber: phoneE164,
          skipNativeAuth: true,
          timeout: 60,
        });
      } catch (error) {
        settleErr(error);
      }
    })();
  });

  nativeVerificationId = verificationId;
  console.info('[phoneAuth] native iOS SMS sent (CapacitorFirebaseAuthentication)');
  return makeJsConfirmation(verificationId);
}

export function getNativePhoneVerificationId(): string | null {
  return nativeVerificationId;
}
