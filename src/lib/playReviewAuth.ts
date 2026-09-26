/**
 * Google Play / store-reviewer Phone Auth bypass.
 *
 * Restricted to ONE Saudi test number. Real users still receive SMS OTP.
 * The OTP is checked again on Cloud Run before minting a Firebase custom token
 * (no SMS gateway, no admin claims). Role follows the login Customer/Driver tab.
 */
import { APP_ROLES } from '@/domain/user-schema';
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';

export const PLAY_REVIEW_PHONE_E164 = '+966500000000';
export const PLAY_REVIEW_PHONE_LOCAL = '0500000000';
export const PLAY_REVIEW_OTP = '123456';
export const PLAY_REVIEW_NAME = 'Test User';
export const PLAY_REVIEW_ROLE = APP_ROLES.B2C_CLIENT;
export const PLAY_REVIEW_ROLES = [APP_ROLES.B2C_CLIENT, APP_ROLES.B2C_DRIVER] as const;
export type PlayReviewRole = (typeof PLAY_REVIEW_ROLES)[number];

export function isPlayReviewPhone(input: string | null | undefined): boolean {
  if (!input) return false;
  try {
    return toFirebasePhoneE164(input) === PLAY_REVIEW_PHONE_E164;
  } catch {
    return false;
  }
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

/** Role from a Firebase ID token minted by `/api/auth/play-review`. */
export function playReviewRoleFromTokenClaims(
  claims: Record<string, unknown> | null | undefined
): PlayReviewRole | null {
  if (!claims) return null;
  const flagged = claims.playReview === true || isPlayReviewPhone(String(claims.phone_number || ''));
  if (!flagged) return null;
  return parsePlayReviewRole(claims.role);
}
