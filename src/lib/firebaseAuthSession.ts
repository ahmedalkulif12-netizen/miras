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

  try {
    await auth.currentUser.getIdToken(false);
  } catch (error) {
    console.warn('[auth] ID token refresh failed — retrying once:', error);
    await auth.currentUser.getIdToken(true);
  }

  return auth.currentUser.uid;
}
