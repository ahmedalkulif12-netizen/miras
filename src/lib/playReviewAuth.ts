/**
 * Google Play / store-reviewer Phone Auth bypass.
 *
 * Restricted to ONE Saudi test number. Real users still receive SMS OTP.
 * The OTP is checked again on Cloud Run before minting a Firebase custom token
 * (no SMS gateway, no admin claims).
 */
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';

export const PLAY_REVIEW_PHONE_E164 = '+966500000000';
export const PLAY_REVIEW_PHONE_LOCAL = '0500000000';
export const PLAY_REVIEW_OTP = '123456';
export const PLAY_REVIEW_NAME = 'Test User';
export const PLAY_REVIEW_ROLE = 'b2c_client' as const;

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
