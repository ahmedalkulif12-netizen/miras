/**
 * Open turn-by-turn navigation on web and Capacitor (iOS/Android).
 * Always Google Maps — never Apple Maps. Native shells must use
 * `comgooglemaps://` / `geo:` / `google.navigation:` schemes because
 * `window.open(https)` is often a no-op inside WKWebView / Android WebView,
 * and `location.href` to google.com is trapped by Capacitor allowNavigation.
 */

import { Capacitor } from '@capacitor/core';

export type MapsNavTarget = {
  lat?: number;
  lng?: number;
  address?: string;
  label?: string;
};

function finiteCoord(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidMapsTarget(
  target: MapsNavTarget | null | undefined
): target is MapsNavTarget {
  if (!target) return false;
  const lat = finiteCoord(target.lat);
  const lng = finiteCoord(target.lng);
  const hasCoords =
    lat != null &&
    lng != null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
  const hasAddress = Boolean(String(target.address || '').trim());
  return hasCoords || hasAddress;
}

function destinationQuery(target: MapsNavTarget): { latlng: string | null; address: string | null; label: string } {
  const lat = finiteCoord(target.lat);
  const lng = finiteCoord(target.lng);
  const hasCoords =
    lat != null &&
    lng != null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
  const address = String(target.address || '').trim() || null;
  return {
    latlng: hasCoords ? `${lat},${lng}` : null,
    address,
    label: encodeURIComponent((target.label || address || 'Destination').slice(0, 80)),
  };
}

function destinationParam(target: MapsNavTarget): string {
  const dest = destinationQuery(target);
  return dest.latlng || encodeURIComponent(dest.address || 'Destination');
}

/** Official Google Maps URLs API — opens the app when installed, otherwise the web UI. */
export function googleMapsDirUrl(target: MapsNavTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destinationParam(target)}&travelmode=driving`;
}

function googleMapsAppUrl(target: MapsNavTarget): string {
  return `comgooglemaps://?daddr=${destinationParam(target)}&directionsmode=driving`;
}

function androidIntentUrl(target: MapsNavTarget): string {
  const daddr = destinationParam(target);
  return (
    `intent://maps.google.com/maps?daddr=${daddr}` +
    `&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end`
  );
}

export function mapsNavigationUrls(target: MapsNavTarget, platform: string): string[] {
  const dest = destinationQuery(target);
  const https = googleMapsDirUrl(target);
  const encodedAddress = dest.address ? encodeURIComponent(dest.address) : '';

  if (platform === 'ios') {
    return [googleMapsAppUrl(target), https];
  }

  if (platform === 'android') {
    return [
      dest.latlng
        ? `geo:${dest.latlng}?q=${dest.latlng}(${dest.label})`
        : `geo:0,0?q=${encodedAddress}`,
      dest.latlng
        ? `google.navigation:q=${dest.latlng}&mode=d`
        : `google.navigation:q=${encodedAddress}&mode=d`,
      androidIntentUrl(target),
      https,
    ];
  }

  return [https];
}

function launchScheme(url: string): void {
  // Capacitor WebViews intercept comgooglemaps / geo / google.navigation schemes.
  // Assigning location launches the native Google Maps app.
  window.location.href = url;
}

function launchExternalHttps(url: string): void {
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Launch Google Maps navigation to a lat/lng or address.
 * Returns false when neither coordinates nor an address is available.
 */
export async function openNativeMapsNavigation(
  target: MapsNavTarget | null | undefined
): Promise<boolean> {
  if (!isValidMapsTarget(target)) return false;
  const lat = finiteCoord(target.lat);
  const lng = finiteCoord(target.lng);
  const normalized: MapsNavTarget = {
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    address: String(target.address || '').trim() || undefined,
    label: target.label,
  };

  let isNative = false;
  let platform = 'web';
  try {
    isNative = Capacitor.isNativePlatform();
    platform = Capacitor.getPlatform();
  } catch {
    isNative = false;
  }

  const href = googleMapsDirUrl(normalized);

  if (isNative) {
    const urls = mapsNavigationUrls(normalized, platform);
    const primary = urls[0];
    if (!primary) return false;
    try {
      launchScheme(primary);
      if (platform === 'ios') {
        // comgooglemaps:// is a no-op if Google Maps is not installed.
        // Do not assign location.href to the https URL — allowNavigation
        // would load Google Maps inside the Capacitor WebView.
        window.setTimeout(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          launchExternalHttps(href);
        }, 700);
      }
      return true;
    } catch {
      return false;
    }
  }

  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = href;
  }
  return true;
}
