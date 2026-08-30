import type { FirebaseOptions } from 'firebase/app';

export interface FirebaseEnvValidationResult {
  ok: boolean;
  firestoreKeyAccepted: boolean;
  authKeyAccepted: boolean;
  hint?: string;
}

/** Ensure Firebase Web config fields all describe the same project/app registration. */
export function assertFirebaseConfigCoherence(firebase: FirebaseOptions): void {
  const { projectId, authDomain, storageBucket, messagingSenderId, appId } = firebase;

  if (!projectId || !authDomain || !messagingSenderId || !appId) return;

  const expectedAuthDomain = `${projectId}.firebaseapp.com`;
  if (authDomain !== expectedAuthDomain) {
    throw new Error(
      `VITE_FIREBASE_AUTH_DOMAIN must be ${expectedAuthDomain} (got ${authDomain}). ` +
        'Copy the full Web app config from Firebase Console → Project settings.'
    );
  }

  if (!appId.startsWith(`1:${messagingSenderId}:`)) {
    throw new Error(
      'VITE_FIREBASE_APP_ID does not match VITE_FIREBASE_MESSAGING_SENDER_ID. ' +
        'All VITE_FIREBASE_* values must come from the same Web app in Firebase Console.'
    );
  }

  if (storageBucket && !storageBucket.includes(projectId)) {
    throw new Error(
      `VITE_FIREBASE_STORAGE_BUCKET must belong to project ${projectId} (got ${storageBucket}).`
    );
  }
}

/**
 * Probes Google APIs to distinguish a dead key from a key that works for Firestore
 * but is blocked for Authentication (common when API restrictions omit Identity Toolkit).
 */
export async function validateFirebaseApiKeyForAuth(
  apiKey: string,
  projectId: string
): Promise<FirebaseEnvValidationResult> {
  const firestoreUrl =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/pricing?pageSize=1&key=${encodeURIComponent(apiKey)}`;

  const firestoreRes = await fetch(firestoreUrl);
  const firestoreJson = (await firestoreRes.json()) as { error?: { message?: string } };
  const firestoreMsg = firestoreJson.error?.message ?? '';

  const firestoreKeyAccepted = !firestoreMsg.includes('API key not valid');

  const itkUrl =
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(apiKey)}`;
  const itkRes = await fetch(itkUrl);
  const itkJson = (await itkRes.json()) as { error?: { message?: string }; projectId?: string };
  const itkMsg = itkJson.error?.message ?? '';

  const authKeyAccepted = !itkMsg.includes('API key not valid') && Boolean(itkJson.projectId);

  if (authKeyAccepted) {
    return { ok: true, firestoreKeyAccepted: true, authKeyAccepted: true };
  }

  if (firestoreKeyAccepted) {
    return {
      ok: false,
      firestoreKeyAccepted: true,
      authKeyAccepted: false,
      hint:
        'VITE_FIREBASE_API_KEY is recognized for Firebase data APIs but rejected for Authentication. ' +
        'In Google Cloud Console → APIs & Services → Credentials → your Browser key → API restrictions, ' +
        "enable \"Identity Toolkit API\" and \"Token Service API\" (or choose \"Don't restrict key\" while testing).",
    };
  }

  return {
    ok: false,
    firestoreKeyAccepted: false,
    authKeyAccepted: false,
    hint:
      'VITE_FIREBASE_API_KEY is rejected by Google. In Firebase Console → Project settings → Your apps → Web app, ' +
      'copy a fresh apiKey into .env, or regenerate the key in Google Cloud Console → Credentials.',
  };
}
