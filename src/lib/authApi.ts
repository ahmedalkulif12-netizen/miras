import { auth, ensureFirebaseReady } from '@/lib/firebase';
import { ensureAppCheckTokenForApi, isAppCheckDisabled, isNativeCapacitorRuntime } from '@/lib/appCheck';
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
  if (!auth.currentUser) {
    try {
      await ensureSignedInFirebaseUid(isDevAuthBypassEnabled() ? 5000 : 12_000);
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
  try {
    return await user.getIdToken(forceRefresh);
  } catch (error) {
    if (!forceRefresh) {
      console.warn('[authApi] ID token unavailable — retrying with force refresh:', error);
      return user.getIdToken(true);
    }
    throw error;
  }
}

function isUnauthorizedStatus(status: number): boolean {
  return status === 401;
}

export async function authFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  await ensureFirebaseReady();

  const send = async (forceRefresh: boolean): Promise<Response> => {
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
      try {
        await ensureSignedInFirebaseUid(12_000);
      } catch (error) {
        console.warn('[authApi] waiting for Firebase session before API call:', error);
      }
      headers.set('Authorization', `Bearer ${await getFirebaseIdToken(forceRefresh)}`);
    }

    let appCheckToken: string | null = null;
    if (!isAppCheckDisabled() && !import.meta.env.DEV) {
      try {
        appCheckToken = await ensureAppCheckTokenForApi(forceRefresh);
      } catch (err) {
        if (isNativeCapacitorRuntime()) {
          console.warn(
            '[authApi] Native App Check token unavailable — continuing without X-Firebase-AppCheck:',
            err
          );
          appCheckToken = null;
        } else {
          throw err;
        }
      }
    } else if (!isAppCheckDisabled() && import.meta.env.DEV) {
      try {
        appCheckToken = await ensureAppCheckTokenForApi(forceRefresh);
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
  };

  let res = await send(false);
  if (isUnauthorizedStatus(res.status) && !isDevBypassAuthSession()) {
    console.warn('[authApi] unauthorized — refreshing session token and retrying once', {
      url,
      status: res.status,
    });
    res = await send(true);
  }
  return res;
}
