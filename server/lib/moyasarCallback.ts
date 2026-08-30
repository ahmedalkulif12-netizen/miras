/**
 * Moyasar hosted-checkout return URL.
 * Production / staging always use APP_URL (HTTPS). Loopback is local-dev only.
 */

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isDemoMoyasarId(id?: string | null): boolean {
  if (!id) return false;
  const value = String(id);
  return value === 'demo' || value.startsWith('demo-');
}

export function resolveMoyasarCallbackUrl(
  requested: unknown,
  appUrl: string,
  options?: { lockToAppUrl?: boolean }
): string {
  const fallback = `${String(appUrl).replace(/\/$/, '')}/payment-callback`;
  if (options?.lockToAppUrl) {
    return fallback;
  }

  if (typeof requested !== 'string' || !requested.trim()) {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(requested.trim());
  } catch {
    return fallback;
  }

  if (
    parsed.pathname !== '/payment-callback' &&
    !parsed.pathname.startsWith('/payment-callback')
  ) {
    return fallback;
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal = isLoopbackHostname(host);
  const isHttps = parsed.protocol === 'https:';
  const isHttpLocal = parsed.protocol === 'http:' && isLocal;

  if (!isHttps && !isHttpLocal) {
    return fallback;
  }

  let appHost = '';
  try {
    appHost = new URL(appUrl).hostname.toLowerCase();
  } catch {
    appHost = '';
  }

  const allowed =
    isLocal ||
    host === appHost ||
    host.endsWith('.web.app') ||
    host.endsWith('.firebaseapp.com') ||
    host.includes('miras') ||
    host.includes('meras') ||
    host.includes('hamula');

  if (!allowed) {
    return fallback;
  }

  return `${parsed.origin}/payment-callback`;
}
