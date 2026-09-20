/**
 * Guarantees a live Firebase Auth user before Firestore order writes.
 * Guest/dev bypass retries Anonymous sign-in so auth.currentUser is never a stub.
 */

import { signInAnonymously } from 'firebase/auth';
import { auth, ensureFirebaseReady, waitForFirebaseAuthUid } from '@/lib/firebase';
import {
  isDevAuthBypassEnabled,
  loadDevBypassProfile,
  saveDevBypassProfile,
  saveLocalGuestRole,
} from '@/lib/devAuthBypass';
import { shouldRefreshIdToken } from '@/lib/authHeaders';

export { shouldRefreshIdToken };

export async function ensureSignedInFirebaseUid(timeoutMs = 12000): Promise<string> {
  await ensureFirebaseReady();

  let uid: string | null = auth.currentUser?.uid || null;
  if (!uid) {
    const waitMs = isDevAuthBypassEnabled() ? Math.min(timeoutMs, 1500) : timeoutMs;
    uid = await waitForFirebaseAuthUid(waitMs);
  }

  if (!uid && isDevAuthBypassEnabled()) {
    try {
      if (auth.currentUser && !auth.currentUser.isAnonymous) {
        uid = auth.currentUser.uid;
      } else {
        const credential = await signInAnonymously(auth);
        uid = credential.user.uid;
        const bypass = loadDevBypassProfile();
        if (bypass?.role) {
          const guestProfile = { ...bypass, uid };
          saveLocalGuestRole(uid, bypass.role);
          saveDevBypassProfile(guestProfile);
        }
        console.info('[auth] recovered Anonymous session for order write', uid);
      }
    } catch (error) {
      console.warn('[auth] Anonymous recovery failed:', error);
    }
  }

  uid = auth.currentUser?.uid || uid || null;

  if (!uid || !auth.currentUser) {
    throw new Error('NOT_AUTHENTICATED');
  }

  await persistCurrentIdToken();
  return auth.currentUser.uid;
}

/** Attach a usable Firebase ID token for API calls (web + Capacitor). */
export async function persistCurrentIdToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('NOT_AUTHENTICATED');
  }
  try {
    if (!forceRefresh) {
      const result = await user.getIdTokenResult(false);
      if (!shouldRefreshIdToken(result.expirationTime)) {
        if (!result.token) throw new Error('NOT_AUTHENTICATED');
        return result.token;
      }
    }
    const token = await user.getIdToken(true);
    if (!token) throw new Error('NOT_AUTHENTICATED');
    return token;
  } catch (error) {
    console.warn('[auth] ID token refresh failed — retrying once:', error);
    const token = await user.getIdToken(true);
    if (!token) throw new Error('NOT_AUTHENTICATED');
    return token;
  }
}

/** Wait for Auth hydration, then return uid + a persisted ID token. */
export async function ensureSessionToken(timeoutMs = 12000): Promise<{ uid: string; token: string }> {
  const uid = await ensureSignedInFirebaseUid(timeoutMs);
  const token = await persistCurrentIdToken(false);
  return { uid, token };
}
