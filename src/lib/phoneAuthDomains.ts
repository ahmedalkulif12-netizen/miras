/**
 * Production Phone Auth / reCAPTCHA hostname helpers.
 * "Hostname match not found" (auth/captcha-check-failed) means the browser
 * hostname is missing from Firebase Auth Authorized domains AND/OR the
 * App Check reCAPTCHA v3 key allowedDomains list.
 */
export function getRequiredPhoneAuthHostnames(projectId: string): string[] {
  const id = projectId.trim();
  return [`${id}.web.app`, `${id}.firebaseapp.com`, '127.0.0.1', 'localhost'];
}

/** Hostnames commonly used for Miras staging Hosting. */
export const DEFAULT_HOSTING_HOSTNAMES = [
  'hamula-cfc6c.web.app',
  'hamula-cfc6c.firebaseapp.com',
] as const;

export function getBrowserHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname || '';
}

/**
 * True when we are on a Firebase Hosting default site for this project
 * (either *.web.app or *.firebaseapp.com).
 */
export function isFirebaseHostingHostname(hostname: string, projectId: string): boolean {
  const host = hostname.trim().toLowerCase();
  const id = projectId.trim().toLowerCase();
  return host === `${id}.web.app` || host === `${id}.firebaseapp.com`;
}

export function buildCaptchaHostnameHint(hostname: string, projectId: string): string {
  const host = hostname || '(unknown host)';
  const required = getRequiredPhoneAuthHostnames(projectId).join(', ');
  return (
    `reCAPTCHA rejected hostname "${host}" (Hostname match not found). ` +
    `In Firebase Console → Authentication → Settings → Authorized domains, add: ${required}. ` +
    `Also ensure the App Check reCAPTCHA v3 key allows these domains ` +
    `(Google Cloud → reCAPTCHA → key → Domains). Current page must be HTTPS on the allowlisted host.`
  );
}
