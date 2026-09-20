/**
 * Firebase ID token helpers for Express auth.
 * Overview/read routes may accept a recently expired token (clock skew / refresh race)
 * instead of returning a hard 401 while the client is still minting a new one.
 */

export const ADMIN_OVERVIEW_CLOCK_SKEW_SECONDS = 10 * 60;
export const ID_TOKEN_VERIFY_ATTEMPTS = 3;
export const ID_TOKEN_VERIFY_RETRY_MS = [150, 400] as const;

export type LooseIdTokenClaims = {
  uid: string;
  sub?: string;
  user_id?: string;
  phone_number?: string;
  admin?: unknown;
  superuser?: unknown;
  role?: unknown;
  exp?: number;
  iat?: number;
  auth_time?: number;
  aud?: string;
  iss?: string;
  firebase?: { sign_in_provider?: string; identities?: Record<string, unknown> };
};

export function authErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const code = (error as { code?: string }).code;
  return typeof code === 'string' ? code : '';
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '');
}

export function isTransientFirebaseAuthError(error: unknown): boolean {
  const code = authErrorCode(error).toLowerCase();
  const message = authErrorMessage(error);
  if (
    /internal-error|network-request-failed|too-many-requests|unavailable|deadline|econnreset|etimedout|enotfound|socket hang up|app\/network-error|app\/invalid-credential|insufficient-permission|failed to determine project/i.test(
      `${code} ${message}`
    )
  ) {
    return true;
  }
  return /default credentials|Could not load the default credentials|unable to detect a Project Id/i.test(
    message
  );
}

export function isExpiredIdTokenError(error: unknown): boolean {
  const code = authErrorCode(error).toLowerCase();
  const message = authErrorMessage(error);
  return (
    code === 'auth/id-token-expired' ||
    /id token has expired|firebase id token has expired/i.test(message)
  );
}

export function decodeIdTokenPayload(token: string): LooseIdTokenClaims | null {
  try {
    const payloadPart = String(token || '').split('.')[1];
    if (!payloadPart) return null;
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    const uid = String(payload.user_id || payload.sub || payload.uid || '').trim();
    if (!uid) return null;
    return {
      uid,
      sub: typeof payload.sub === 'string' ? payload.sub : uid,
      user_id: typeof payload.user_id === 'string' ? payload.user_id : uid,
      phone_number: typeof payload.phone_number === 'string' ? payload.phone_number : undefined,
      admin: payload.admin,
      superuser: payload.superuser,
      role: payload.role,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      auth_time: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
      aud: typeof payload.aud === 'string' ? payload.aud : undefined,
      iss: typeof payload.iss === 'string' ? payload.iss : undefined,
      firebase:
        payload.firebase && typeof payload.firebase === 'object'
          ? (payload.firebase as LooseIdTokenClaims['firebase'])
          : undefined,
    };
  } catch {
    return null;
  }
}

export function isWithinClockSkew(
  claims: Pick<LooseIdTokenClaims, 'exp'>,
  skewSeconds: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(skewSeconds) || skewSeconds <= 0) return false;
  const exp = Number(claims.exp || 0);
  if (!exp) return false;
  return nowSec - exp <= skewSeconds;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
