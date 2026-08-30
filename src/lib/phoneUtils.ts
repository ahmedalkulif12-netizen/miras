/**
 * Saudi (+966) phone normalization for Firebase Phone Auth (E.164).
 */

const SAUDI_COUNTRY = '+966';

/** Strip non-digits and normalize to E.164 (+9665XXXXXXXX). */
export function normalizeSaudiPhone(input: string): string {
  const digits = input.replace(/\D/g, '');

  if (digits.startsWith('966') && digits.length >= 12) {
    return `+${digits}`;
  }

  if (digits.startsWith('05') && digits.length === 10) {
    return `${SAUDI_COUNTRY}${digits.slice(1)}`;
  }

  if (digits.startsWith('5') && digits.length === 9) {
    return `${SAUDI_COUNTRY}${digits}`;
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return `${SAUDI_COUNTRY}${digits.slice(1)}`;
  }

  throw new Error('INVALID_SA_PHONE');
}

/** Strict E.164 for Firebase Phone Auth (+9665XXXXXXXX). */
export function toFirebasePhoneE164(input: string): string {
  const e164 = normalizeSaudiPhone(input);
  if (!/^\+9665\d{8}$/.test(e164)) {
    throw Object.assign(new Error('INVALID_SA_PHONE'), { code: 'INVALID_SA_PHONE' });
  }
  return e164;
}

export function isValidSaudiPhoneInput(input: string): boolean {
  try {
    normalizeSaudiPhone(input);
    return true;
  } catch {
    return false;
  }
}
