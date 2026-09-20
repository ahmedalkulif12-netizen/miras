export function buildBearerAuthorization(token: string): string {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    throw new Error('NOT_AUTHENTICATED');
  }
  return `Bearer ${trimmed}`;
}

/** Refresh when expiry is missing or within `skewMs` of now (default 5 minutes). */
export function shouldRefreshIdToken(
  expirationTime: string | number | Date,
  nowMs: number = Date.now(),
  skewMs: number = 5 * 60 * 1000
): boolean {
  const exp =
    typeof expirationTime === 'number'
      ? expirationTime
      : expirationTime instanceof Date
        ? expirationTime.getTime()
        : Date.parse(String(expirationTime));
  return !Number.isFinite(exp) || exp - nowMs < skewMs;
}
