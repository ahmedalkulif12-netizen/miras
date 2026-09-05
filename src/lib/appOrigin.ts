/**
 * Public HTTPS origin for Moyasar callbacks and native App / Universal Links.
 * Capacitor WebViews use https://localhost / capacitor://localhost — never send
 * those to Moyasar. Prefer VITE_APP_URL, then the Firebase Hosting site.
 */
import { Capacitor } from '@capacitor/core';

export const DEFAULT_PUBLIC_APP_HOST = 'hamula-cfc6c.web.app';
export const ANDROID_APP_PACKAGE = 'com.miras.app';
export const IOS_BUNDLE_ID = 'com.ahmed.miras';

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost')
  );
}

export function hostingOriginFromFirebaseProject(projectId?: string): string {
  const id = (projectId || '').trim();
  return id ? `https://${id}.web.app` : `https://${DEFAULT_PUBLIC_APP_HOST}`;
}

function originIfPublicHttps(raw?: string): string {
  const value = (raw || '').trim().replace(/\/$/, '');
  if (!value) return '';
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (parsed.protocol !== 'https:') return '';
    if (isLoopbackHostname(parsed.hostname)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function resolvePublicAppOrigin(input: {
  envAppUrl?: string;
  firebaseProjectId?: string;
  windowOrigin?: string;
  isNative?: boolean;
  isProdBuild?: boolean;
}): string {
  const fromEnv = originIfPublicHttps(input.envAppUrl);
  if (fromEnv) return fromEnv;

  const hosting = hostingOriginFromFirebaseProject(input.firebaseProjectId);
  if (input.isNative || input.isProdBuild) {
    return hosting;
  }

  const fromWindow = originIfPublicHttps(input.windowOrigin);
  if (fromWindow) return fromWindow;

  return hosting;
}

export function getPublicAppOrigin(): string {
  const windowOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  let isNative = false;
  try {
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }

  return resolvePublicAppOrigin({
    envAppUrl: import.meta.env.VITE_APP_URL,
    firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    windowOrigin,
    isNative,
    isProdBuild: import.meta.env.PROD,
  });
}

export function getMoyasarCallbackUrl(draftId?: string): string {
  const base = `${getPublicAppOrigin()}/payment-callback`;
  const id = String(draftId || '').trim();
  if (!id) return base;
  return `${base}?draftId=${encodeURIComponent(id)}`;
}

/** Map an App Link / custom-scheme URL to an in-app SPA path. */
export function nativeOpenUrlToSpaPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (
    protocol === ANDROID_APP_PACKAGE ||
    protocol === IOS_BUNDLE_ID ||
    protocol === 'miras'
  ) {
    const host = parsed.hostname;
    const nested = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const spaPath = host ? `/${host}${nested}` : nested || '/';
    return `${spaPath}${parsed.search}${parsed.hash}`;
  }

  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return path.startsWith('/') ? path : `/${path}`;
}

export function shouldApplyNativeDeepLink(path: string): boolean {
  const pathname = path.split('?')[0].split('#')[0];
  return Boolean(pathname && pathname !== '/');
}
