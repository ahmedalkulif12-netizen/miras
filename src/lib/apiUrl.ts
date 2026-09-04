/**
 * Resolves API paths for same-origin (Express / Cloud Run behind Hosting) or split
 * deployments via VITE_API_ORIGIN.
 *
 * Capacitor WKWebView origins (`capacitor://…`) cannot serve `/api/**`. Native
 * store builds must call the public HTTPS app origin (Firebase Hosting → Cloud Run).
 */
import { Capacitor } from '@capacitor/core';
import { getPublicAppOrigin, isLoopbackHostname } from '@/lib/appOrigin';

export function resolveApiOriginFrom(input: {
  envApiOrigin?: string;
  publicAppOrigin?: string;
  isNative?: boolean;
  windowOrigin?: string;
}): string {
  const explicit = (input.envApiOrigin || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const windowOrigin = (input.windowOrigin || '').trim();
  let windowHost = '';
  let windowProtocol = '';
  try {
    if (windowOrigin) {
      const parsed = new URL(windowOrigin);
      windowHost = parsed.hostname.toLowerCase();
      windowProtocol = parsed.protocol.replace(/:$/, '').toLowerCase();
    }
  } catch {
    /* ignore */
  }

  const nativeScheme =
    windowProtocol === 'capacitor' ||
    windowProtocol === 'ionic' ||
    windowProtocol === 'file';
  const nativeLoopbackHttps =
    windowProtocol === 'https' && isLoopbackHostname(windowHost);

  if (input.isNative || nativeScheme || nativeLoopbackHttps) {
    return (input.publicAppOrigin || '').trim().replace(/\/$/, '');
  }

  return '';
}

export function getApiOrigin(): string {
  let isNative = false;
  try {
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }

  const windowOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return resolveApiOriginFrom({
    envApiOrigin: import.meta.env.VITE_API_ORIGIN,
    publicAppOrigin: getPublicAppOrigin(),
    isNative,
    windowOrigin,
  });
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}
