/**
 * Saudi (+966) phone normalization for Firebase Phone Auth (E.164).
 */

const SAUDI_COUNTRY = '+966';

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
