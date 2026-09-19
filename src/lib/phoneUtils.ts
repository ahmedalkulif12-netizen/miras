/**
 * Saudi (+966) phone normalization for Firebase Phone Auth (E.164).
 * Converts +966 / 054 / 54 / Arabic digits to +9665XXXXXXXX with no spaces
 * or extra trunk zeros.
 */

const SAUDI_COUNTRY = '+966';
const E164_SAUDI_MOBILE = /^\+9665\d{8}$/;

/** Convert Arabic-Indic / Eastern Arabic digits to ASCII 0-9. */
export function toAsciiDigits(input: string): string {
  return String(input || '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

/** Keep typed login fields numeric while still accepting pasted +966 / Arabic digits. */
export function sanitizeSaudiPhoneInput(input: string): string {
  return toAsciiDigits(input).replace(/\D/g, '');
}

function invalidSaudiPhone(): never {
  throw Object.assign(new Error('INVALID_SA_PHONE'), { code: 'INVALID_SA_PHONE' });
}

/** Strip non-digits and normalize to E.164 (+9665XXXXXXXX). */
export function normalizeSaudiPhone(input: string): string {
  let digits = sanitizeSaudiPhoneInput(input);

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('966')) {
    const national = digits.slice(3).replace(/^0+/, '');
    if (national.length === 9 && national.startsWith('5')) {
      return `${SAUDI_COUNTRY}${national}`;
    }
    invalidSaudiPhone();
  }

  if (digits.startsWith('05')) {
    const national = digits.replace(/^0+/, '');
    if (national.length === 9 && national.startsWith('5')) {
      return `${SAUDI_COUNTRY}${national}`;
    }
    invalidSaudiPhone();
  }

  if (digits.startsWith('5') && digits.length === 9) {
    return `${SAUDI_COUNTRY}${digits}`;
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    const national = digits.slice(1);
    if (national.length === 9 && national.startsWith('5')) {
      return `${SAUDI_COUNTRY}${national}`;
    }
  }

  invalidSaudiPhone();
}

/** Strict E.164 for Firebase Phone Auth: +9665XXXXXXXX, no spaces or leading zeros. */
export function toFirebasePhoneE164(input: string): string {
  const compact = toAsciiDigits(String(input || '')).replace(/[\s\-\(\)\.]/g, '');
  const e164 = normalizeSaudiPhone(compact);
  if (/\s/.test(e164) || e164.startsWith('+9660') || !E164_SAUDI_MOBILE.test(e164)) {
    invalidSaudiPhone();
  }
  return e164;
}

/** Alias — same synchronous E.164 conversion used before native verifyPhoneNumber. */
export const formatSaudiPhoneE164Sync = toFirebasePhoneE164;

export function isValidSaudiPhoneInput(input: string): boolean {
  try {
    toFirebasePhoneE164(input);
    return true;
  } catch {
    return false;
  }
}
