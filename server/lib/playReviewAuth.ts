/**
 * Google Play reviewer Phone Auth — server gate.
 * Only +966500000000 / 123456 may mint a custom token. Never grants admin.
 * Role follows the login tab (customer vs driver) so reviewers can open either panel.
 */
import firebaseAdmin from 'firebase-admin';
import { APP_ROLES, type AppRole } from '../../src/domain/user-schema.ts';

export const PLAY_REVIEW_PHONE_E164 = '+966500000000';
export const PLAY_REVIEW_OTP = '123456';
export const PLAY_REVIEW_NAME = 'Test User';
export const PLAY_REVIEW_ROLE = APP_ROLES.B2C_CLIENT;
export const PLAY_REVIEW_ROLES = [APP_ROLES.B2C_CLIENT, APP_ROLES.B2C_DRIVER] as const;
export type PlayReviewRole = (typeof PLAY_REVIEW_ROLES)[number];

const PLAY_REVIEW_KYC_FILE = (key: string) => ({
  status: 'uploaded' as const,
  storagePath: `play-review/${key}.jpg`,
  fileName: `play-review-${key}.jpg`,
  uploadedAt: new Date().toISOString(),
});

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

export function parsePlayReviewRole(raw: unknown): PlayReviewRole {
  const value = String(raw || '').trim().toLowerCase();
  if (value === APP_ROLES.B2C_DRIVER || value === 'driver') {
    return APP_ROLES.B2C_DRIVER;
  }
  return APP_ROLES.B2C_CLIENT;
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
    role: PlayReviewRole;
    name: string;
    playReview: true;
    vehicleType?: string;
    accountStatus?: string;
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

async function applyPlayReviewRoleDocs(
  db: firebaseAdmin.firestore.Firestore,
  uid: string,
  role: PlayReviewRole,
  name: string
): Promise<void> {
  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp();
  const isDriver = role === APP_ROLES.B2C_DRIVER;
  const accountStatus = isDriver ? 'approved' : 'active';

  await db.collection('users').doc(uid).set(
    {
      uid,
      phone: PLAY_REVIEW_PHONE_E164,
      role,
      name,
      accountStatus,
      playReview: true,
      ...(isDriver
        ? {
            vehicleType: 'flatbed',
            vehicleOption: 'normal',
            documentUploadStatuses: {
              id: 'uploaded',
              registration: 'uploaded',
              permit: 'uploaded',
              license: 'uploaded',
            },
            documentFiles: {
              id: PLAY_REVIEW_KYC_FILE('id'),
              registration: PLAY_REVIEW_KYC_FILE('registration'),
              permit: PLAY_REVIEW_KYC_FILE('permit'),
              license: PLAY_REVIEW_KYC_FILE('license'),
            },
          }
        : {}),
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('customers').doc(uid).set(
    {
      uid,
      fullName: name,
      phone: PLAY_REVIEW_PHONE_E164,
      role: APP_ROLES.B2C_CLIENT,
      playReview: true,
      accountStatus: 'active',
      updatedAt: now,
    },
    { merge: true }
  );

  if (isDriver) {
    await db.collection('drivers').doc(uid).set(
      {
        uid,
        fullName: name,
        phone: PLAY_REVIEW_PHONE_E164,
        role: APP_ROLES.B2C_DRIVER,
        playReview: true,
        accountStatus: 'approved',
        vehicleType: 'flatbed',
        vehicleSize: 'normal',
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

export async function issuePlayReviewSession(
  auth: firebaseAdmin.auth.Auth,
  db: firebaseAdmin.firestore.Firestore,
  requestedRole: unknown = PLAY_REVIEW_ROLE
): Promise<PlayReviewSession> {
  const role = parsePlayReviewRole(requestedRole);
  const user = await loadOrCreatePlayReviewUser(auth);
  const uid = user.uid;

  const existingClaims = user.customClaims ?? {};
  const { admin: _a, superuser: _s, ...rest } = existingClaims as Record<string, unknown>;
  await auth.setCustomUserClaims(uid, {
    ...rest,
    admin: false,
    superuser: false,
    playReview: true,
    role,
  });

  const userRef = db.collection('users').doc(uid);
  const existing = await userRef.get();
  const existingName = existing.exists ? String(existing.data()?.name || '').trim() : '';
  const name = existingName || PLAY_REVIEW_NAME;

  await applyPlayReviewRoleDocs(db, uid, role, name);

  const customToken = await auth.createCustomToken(uid, {
    playReview: true,
    role,
  });

  return {
    uid,
    customToken,
    profile: {
      uid,
      phone: PLAY_REVIEW_PHONE_E164,
      role,
      name,
      playReview: true,
      ...(role === APP_ROLES.B2C_DRIVER
        ? { vehicleType: 'flatbed', accountStatus: 'approved' }
        : { accountStatus: 'active' }),
    },
  };
}

export function isPlayReviewToken(decoded: unknown): boolean {
  if (!decoded || typeof decoded !== 'object') return false;
  const rec = decoded as { playReview?: unknown; phone_number?: string };
  if (rec.playReview === true) return true;
  return isPlayReviewPhone(rec.phone_number);
}
