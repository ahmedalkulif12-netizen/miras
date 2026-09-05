/**
 * Open turn-by-turn navigation on web and Capacitor (iOS/Android).
 * Native shells must use geo / maps URL schemes — `window.open(https)` is a no-op
 * or a blocked popup inside WKWebView and Android WebView.
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

function googleDirUrl(target: MapsNavTarget): string {
  const dest = destinationQuery(target);
  const q = dest.latlng || encodeURIComponent(dest.address || 'Destination');
  return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
}

function androidIntentUrl(target: MapsNavTarget): string {
  const dest = destinationQuery(target);
  const daddr = dest.latlng || encodeURIComponent(dest.address || '');
  return (
    `intent://maps.google.com/maps?daddr=${daddr}` +
    `&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end`
  );
}

function candidateUrls(target: MapsNavTarget, platform: string): string[] {
  const dest = destinationQuery(target);
  const https = googleDirUrl(target);
  const encodedAddress = dest.address ? encodeURIComponent(dest.address) : '';

  if (platform === 'ios') {
    return [
      dest.latlng
        ? `maps://maps.apple.com/?daddr=${dest.latlng}&dirflg=d`
        : `maps://maps.apple.com/?daddr=${encodedAddress}&dirflg=d`,
      dest.latlng
        ? `comgooglemaps://?daddr=${dest.latlng}&directionsmode=driving`
        : `comgooglemaps://?daddr=${encodedAddress}&directionsmode=driving`,
      dest.latlng
        ? `maps:0,0?q=${dest.latlng}(${dest.label})`
        : `maps:0,0?q=${encodedAddress}`,
      https,
    ];
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
  // Capacitor WebViews intercept geo / maps / google.navigation schemes.
  // window.open(https) is a no-op; assigning location launches the native app.
  window.location.href = url;
}

/**
 * Launch Google Maps / Apple Maps navigation to a lat/lng or address.
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

  const urls = candidateUrls(normalized, isNative ? platform : 'web');

  if (isNative) {
    const primary = urls[0];
    if (!primary) return false;
    try {
      launchScheme(primary);
      return true;
    } catch {
      return false;
    }
  }

  const href = googleDirUrl(normalized);
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = href;
  }
  return true;
}
