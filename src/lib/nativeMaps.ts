/**
 * Open turn-by-turn navigation on web and Capacitor (iOS/Android).
 * `window.open` is blocked or no-ops inside WKWebView / Android WebView.
 */

import { Capacitor } from '@capacitor/core';

export type MapsNavTarget = {
  lat: number;
  lng: number;
  label?: string;
};

function isValidTarget(target: MapsNavTarget | null | undefined): target is MapsNavTarget {
  if (!target) return false;
  const { lat, lng } = target;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function googleDirUrl(target: MapsNavTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
}

function candidateUrls(target: MapsNavTarget, platform: string): string[] {
  const label = encodeURIComponent(target.label || 'Destination');
  const https = googleDirUrl(target);
  if (platform === 'ios') {
    return [
      `comgooglemaps://?daddr=${target.lat},${target.lng}&directionsmode=driving`,
      `maps://?daddr=${target.lat},${target.lng}&dirflg=d`,
      https,
    ];
  }
  if (platform === 'android') {
    return [
      `google.navigation:q=${target.lat},${target.lng}&mode=d`,
      `geo:${target.lat},${target.lng}?q=${target.lat},${target.lng}(${label})`,
      https,
    ];
  }
  return [https];
}

async function openUrlNative(url: string): Promise<boolean> {
  try {
    const opener = window.open(url, '_blank', 'noopener,noreferrer');
    if (opener) return true;
  } catch {
    /* WebView may block window.open */
  }
  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    try {
      window.location.href = url;
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Launch Google Maps / Apple Maps navigation to a lat/lng.
 * Returns false when coordinates are missing.
 */
export async function openNativeMapsNavigation(
  target: MapsNavTarget | null | undefined
): Promise<boolean> {
  if (!isValidTarget(target)) return false;

  let isNative = false;
  let platform = 'web';
  try {
    isNative = Capacitor.isNativePlatform();
    platform = Capacitor.getPlatform();
  } catch {
    isNative = false;
  }

  if (isNative) {
    for (const url of candidateUrls(target, platform)) {
      if (await openUrlNative(url)) return true;
    }
    return false;
  }

  const href = googleDirUrl(target);
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = href;
  }
  return true;
}
