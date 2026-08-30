import { auth, ensureFirebaseReady } from '@/lib/firebase';
import { ensureAppCheckTokenForApi, isAppCheckDisabled } from '@/lib/appCheck';
import { resolveApiUrl } from '@/lib/apiUrl';
import { isDevAuthBypassEnabled, loadDevBypassProfile } from '@/lib/devAuthBypass';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';

/** True when the screenshot/dev bypass session is active (no real Firebase Auth user). */
export function isDevBypassAuthSession(): boolean {
  return isDevAuthBypassEnabled() && loadDevBypassProfile() !== null && !auth.currentUser;
}

const DEV_BYPASS_BEARER = 'dev-bypass-token';

/** Firebase ID token for secured server APIs (payments / orders). */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string> {
  if (!auth.currentUser && isDevAuthBypassEnabled() && loadDevBypassProfile()) {
    try {
      await ensureSignedInFirebaseUid(5000);
    } catch {
      /* fall through */
    }
  }
  const user = auth.currentUser;
  if (!user) {
    if (isDevBypassAuthSession()) {
      throw new Error('DEV_BYPASS_NO_FIREBASE_SESSION');
    }
    throw new Error('NOT_AUTHENTICATED');
  }
  return user.getIdToken(forceRefresh);
}

export async function authFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  await ensureFirebaseReady();

  if (!auth.currentUser && isDevAuthBypassEnabled() && loadDevBypassProfile()) {
    try {
      await ensureSignedInFirebaseUid(5000);
    } catch {
      /* fall through to bypass bearer or 401 */
    }
  }

  const headers = new Headers(init.headers);
  if (isDevBypassAuthSession()) {
    const profile = loadDevBypassProfile();
    headers.set('Authorization', `Bearer ${DEV_BYPASS_BEARER}`);
    if (profile?.uid) {
      headers.set('X-Dev-Bypass-Uid', profile.uid);
    }
  } else {
    headers.set('Authorization', `Bearer ${await getFirebaseIdToken()}`);
  }

  // Localhost: never block API calls on App Check exchangeDebugToken 403.
  let appCheckToken: string | null = null;
  if (!isAppCheckDisabled() && !import.meta.env.DEV) {
    appCheckToken = await ensureAppCheckTokenForApi(false);
  } else if (!isAppCheckDisabled() && import.meta.env.DEV) {
    try {
      appCheckToken = await ensureAppCheckTokenForApi(false);
    } catch (err) {
      console.warn('[authApi] App Check token soft-fail (dev) — continuing without X-Firebase-AppCheck:', err);
      appCheckToken = null;
    }
  }

  if (appCheckToken) {
    headers.set('X-Firebase-AppCheck', appCheckToken);
  }
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(resolveApiUrl(url), { ...init, headers });
}
