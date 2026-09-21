/**
 * Google Play reviewer Phone Auth — server gate.
 * Only +966500000000 / 123456 may mint a custom token. Never grants admin.
 */
import firebaseAdmin from 'firebase-admin';

export const PLAY_REVIEW_PHONE_E164 = '+966500000000';
export const PLAY_REVIEW_OTP = '123456';
export const PLAY_REVIEW_NAME = 'Test User';
export const PLAY_REVIEW_ROLE = 'b2c_client' as const;

function saudiDigits(value: string): string {
  return String(value || '').replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
}

export function isPlayReviewPhone(phone: string | null | undefined): boolean {
  return saudiDigits(phone || '') === saudiDigits(PLAY_REVIEW_PHONE_E164);
}

export function isPlayReviewOtp(otp: string | null | undefined): boolean {
  return String(otp || '').replace(/\D/g, '') === PLAY_REVIEW_OTP;
}

export function isPlayReviewCredentials(
  phone: string | null | undefined,
  otp: string | null | undefined
): boolean {
  return isPlayReviewPhone(phone) && isPlayReviewOtp(otp);
}

const rateHits = new Map<string, number[]>();

export function consumePlayReviewRateLimit(
  key: string,
  nowMs: number = Date.now(),
  windowMs = 10 * 60 * 1000,
  maxHits = 12
): boolean {
  const id = String(key || 'unknown');
  const recent = (rateHits.get(id) || []).filter((stamp) => nowMs - stamp < windowMs);
  if (recent.length >= maxHits) {
    rateHits.set(id, recent);
    return false;
  }
  recent.push(nowMs);
  rateHits.set(id, recent);
  return true;
}

export interface PlayReviewSession {
  uid: string;
  customToken: string;
  profile: {
    uid: string;
    phone: string;
    role: typeof PLAY_REVIEW_ROLE;
    name: string;
  };
}

async function loadOrCreatePlayReviewUser(
  auth: firebaseAdmin.auth.Auth
): Promise<firebaseAdmin.auth.UserRecord> {
  try {
    return await auth.getUserByPhoneNumber(PLAY_REVIEW_PHONE_E164);
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (code !== 'auth/user-not-found') throw error;
  }

  try {
    return await auth.createUser({
      phoneNumber: PLAY_REVIEW_PHONE_E164,
      displayName: PLAY_REVIEW_NAME,
      disabled: false,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/uid-already-exists' || code === 'auth/phone-number-already-exists') {
      return auth.getUserByPhoneNumber(PLAY_REVIEW_PHONE_E164);
    }
    throw error;
  }
}

export async function issuePlayReviewSession(
  auth: firebaseAdmin.auth.Auth,
  db: firebaseAdmin.firestore.Firestore
): Promise<PlayReviewSession> {
  const user = await loadOrCreatePlayReviewUser(auth);
  const uid = user.uid;

  const existingClaims = user.customClaims ?? {};
  const { admin: _a, superuser: _s, ...rest } = existingClaims as Record<string, unknown>;
  await auth.setCustomUserClaims(uid, {
    ...rest,
    admin: false,
    superuser: false,
    playReview: true,
    role: PLAY_REVIEW_ROLE,
  });

  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp();
  const userRef = db.collection('users').doc(uid);
  const existing = await userRef.get();
  const existingName = existing.exists ? String(existing.data()?.name || '').trim() : '';

  await userRef.set(
    {
      uid,
      phone: PLAY_REVIEW_PHONE_E164,
      role: PLAY_REVIEW_ROLE,
      name: existingName || PLAY_REVIEW_NAME,
      accountStatus: 'active',
      playReview: true,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );

  await db.collection('customers').doc(uid).set(
    {
      uid,
      fullName: existingName || PLAY_REVIEW_NAME,
      phone: PLAY_REVIEW_PHONE_E164,
      role: PLAY_REVIEW_ROLE,
      playReview: true,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );

  const customToken = await auth.createCustomToken(uid, {
    playReview: true,
    role: PLAY_REVIEW_ROLE,
  });

  return {
    uid,
    customToken,
    profile: {
      uid,
      phone: PLAY_REVIEW_PHONE_E164,
      role: PLAY_REVIEW_ROLE,
      name: existingName || PLAY_REVIEW_NAME,
    },
  };
}
