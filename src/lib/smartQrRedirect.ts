/**
 * Smart / Universal QR routing — iOS → App Store, Android → Play Store, else landing.
 * Shared by Express (real 302) and the SPA fallback if Hosting serves index.html.
 */
import {
  MIRAS_ANDROID_PACKAGE,
  MIRAS_PRODUCTION_API_ORIGIN,
} from './mirasProductionFirebase.ts';

export type SmartQrPlatform = 'ios' | 'android' | 'other';

export const DEFAULT_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${MIRAS_ANDROID_PACKAGE}`;
/** Used until App Store Connect numeric Apple ID is set in env. */
export const DEFAULT_IOS_APP_STORE_URL = 'https://apps.apple.com/sa/search?term=Miras';

function readEnv(name: string, env?: Record<string, string | undefined>): string {
  const fromBag = env?.[name];
  if (typeof fromBag === 'string' && fromBag.trim()) return fromBag.trim();
  try {
    const viteVal = import.meta.env?.[name as keyof ImportMetaEnv];
    if (typeof viteVal === 'string' && viteVal.trim()) return viteVal.trim();
  } catch {
    // Node (tsx / CJS) does not always populate import.meta.env
  }
  if (typeof process !== 'undefined' && typeof process.env?.[name] === 'string') {
    return process.env[name]!.trim();
  }
  return '';
}

function firstEnv(names: string[], env?: Record<string, string | undefined>): string {
  for (const name of names) {
    const value = readEnv(name, env);
    if (value) return value;
  }
  return '';
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeHttpUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isSafeHttpUrl(withProtocol) ? withProtocol : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function appleIdFromEnv(raw: string): string {
  const digits = raw.replace(/^id/i, '').replace(/\D/g, '');
  return digits;
}

export function detectSmartQrPlatform(userAgent: string): SmartQrPlatform {
  const ua = String(userAgent || '');
  // iOS first — some Android WebViews mention Safari but not iPhone/iPad/iPod.
  if (/\b(iPhone|iPad|iPod)\b/i.test(ua)) return 'ios';
  if (/\bAndroid\b/i.test(ua)) return 'android';
  return 'other';
}

export function resolveIosAppStoreUrl(env?: Record<string, string | undefined>): string {
  const explicit = firstEnv(['IOS_APP_STORE_URL', 'VITE_IOS_APP_STORE_URL'], env);
  if (explicit) return sanitizeHttpUrl(explicit, DEFAULT_IOS_APP_STORE_URL);
  const appleId = appleIdFromEnv(firstEnv(['APP_STORE_APPLE_ID', 'VITE_APP_STORE_APPLE_ID'], env));
  if (appleId) return `https://apps.apple.com/app/id${appleId}`;
  return DEFAULT_IOS_APP_STORE_URL;
}

export function resolveAndroidPlayStoreUrl(env?: Record<string, string | undefined>): string {
  const explicit = firstEnv(['ANDROID_PLAY_STORE_URL', 'VITE_ANDROID_PLAY_STORE_URL'], env);
  if (explicit) return sanitizeHttpUrl(explicit, DEFAULT_PLAY_STORE_URL);
  return DEFAULT_PLAY_STORE_URL;
}

export function resolveSmartQrLandingUrl(
  env?: Record<string, string | undefined>,
  appUrl?: string
): string {
  const explicit = (appUrl || '').trim() || firstEnv(['APP_URL', 'VITE_APP_URL'], env);
  const fallback = MIRAS_PRODUCTION_API_ORIGIN;
  const chosen = sanitizeHttpUrl(explicit, fallback);
  return stripTrailingSlash(chosen) || fallback;
}

export type SmartQrStoreUrls = {
  ios: string;
  android: string;
  web: string;
};

export function getSmartQrStoreUrls(
  env?: Record<string, string | undefined>,
  appUrl?: string
): SmartQrStoreUrls {
  return {
    ios: resolveIosAppStoreUrl(env),
    android: resolveAndroidPlayStoreUrl(env),
    web: resolveSmartQrLandingUrl(env, appUrl),
  };
}

export function resolveSmartQrRedirectUrl(
  userAgent: string,
  options?: { env?: Record<string, string | undefined>; appUrl?: string }
): string {
  const urls = getSmartQrStoreUrls(options?.env, options?.appUrl);
  const platform = detectSmartQrPlatform(userAgent);
  if (platform === 'ios') return urls.ios;
  if (platform === 'android') return urls.android;
  return urls.web;
}
