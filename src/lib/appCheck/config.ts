/**
 * Miras Firebase App Check — reCAPTCHA v3 site key.
 * Firebase Console → App Check → Web app → reCAPTCHA v3.
 */
export const MIRAS_RECAPTCHA_V3_SITE_KEY =
  '6Lf0czctAAAAAF7EECTuyfcTMJpA7HCTBlLp7Syb';

/** @deprecated Use MIRAS_RECAPTCHA_V3_SITE_KEY */
export const HAMOULA_RECAPTCHA_V3_SITE_KEY = MIRAS_RECAPTCHA_V3_SITE_KEY;

const RECAPTCHA_V3_PATTERN = /^6L[\w-]{38,42}$/;

export function normalizeRecaptchaSiteKey(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

export function validateRecaptchaSiteKey(siteKey: string | undefined): {
  ok: boolean;
  siteKey?: string;
  error?: string;
} {
  const normalized = normalizeRecaptchaSiteKey(siteKey);
  if (!normalized) {
    return { ok: false, error: 'VITE_APP_CHECK_RECAPTCHA_SITE_KEY is not set.' };
  }

  if (!RECAPTCHA_V3_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: `Invalid reCAPTCHA v3 site key format: ${normalized}`,
    };
  }

  return { ok: true, siteKey: normalized };
}
