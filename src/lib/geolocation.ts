import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

export interface GeoCoordinates {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

/** Riyadh center. Used when GPS times out so the map stays usable. */
export const DEFAULT_MAP_CENTER: GeoCoordinates = { lat: 24.7136, lng: 46.6753 };

const HIGH_ACCURACY_MS = 12_000;
const COARSE_MS = 10_000;
/** Long enough for the iOS system prompt. A shorter cap treats "Allow" as a failure. */
const PERMISSION_MS = 25_000;

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(coded(code)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Normalize browser and Capacitor Geolocation failures to a stable code. */
export function locationFailureCode(error: unknown): string {
  const err = error as { code?: string | number; message?: string };
  const code = String(err?.code ?? '');
  const message = String(err?.message || '');
  if (
    code === 'LOCATION_PERMISSION_DENIED' ||
    code === 'LOCATION_SERVICES_DISABLED' ||
    code === 'OS-PLUG-GLOC-0003' ||
    code === 'OS-PLUG-GLOC-0007' ||
    code === 'OS-PLUG-GLOC-0008' ||
    code === '1'
  ) {
    return code === 'OS-PLUG-GLOC-0007' || code === 'LOCATION_SERVICES_DISABLED'
      ? 'LOCATION_SERVICES_DISABLED'
      : 'LOCATION_PERMISSION_DENIED';
  }
  if (code === 'GEOLOCATION_UNSUPPORTED') return 'GEOLOCATION_UNSUPPORTED';
  if (/denied|not enabled|restricted/i.test(message)) return 'LOCATION_PERMISSION_DENIED';
  if (
    code === 'LOCATION_TIMEOUT' ||
    code === 'OS-PLUG-GLOC-0010' ||
    code === '3' ||
    /timeout/i.test(message)
  ) {
    return 'LOCATION_TIMEOUT';
  }
  return 'LOCATION_UNAVAILABLE';
}

async function browserLocationAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  const permissions = navigator.permissions;
  if (!permissions?.query) return true;
  try {
    const status = await permissions.query({ name: 'geolocation' });
    return status.state !== 'denied';
  } catch {
    return true;
  }
}

/**
 * Request location permission on Android, iOS, and the browser.
 * Native shells use the Capacitor prompt (25s). Browsers prompt on the
 * position read itself; a previous denial returns false immediately.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return browserLocationAvailable();
  }

  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted' || status.coarseLocation === 'granted') {
      return true;
    }
    const requested = await Geolocation.requestPermissions();
    return requested.location === 'granted' || requested.coarseLocation === 'granted';
  } catch (error) {
    console.warn('[geolocation] permission request failed:', error);
    return false;
  }
}

async function readNativePosition(
  enableHighAccuracy: boolean,
  timeout: number,
  maximumAge: number
): Promise<GeoCoordinates> {
  const position = await withTimeout(
    Geolocation.getCurrentPosition({ enableHighAccuracy, timeout, maximumAge }),
    timeout + 1_500,
    'LOCATION_TIMEOUT'
  );
  return mapCapacitorPosition(position);
}

function readBrowserPosition(
  enableHighAccuracy: boolean,
  timeout: number,
  maximumAge: number
): Promise<GeoCoordinates> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(coded('GEOLOCATION_UNSUPPORTED'));
  }
  return withTimeout(
    new Promise<GeoCoordinates>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(mapWebPosition(pos)),
        (err) => {
          const code =
            err.code === 1
              ? 'LOCATION_PERMISSION_DENIED'
              : err.code === 3
                ? 'LOCATION_TIMEOUT'
                : 'LOCATION_UNAVAILABLE';
          reject(coded(code));
        },
        { enableHighAccuracy, timeout, maximumAge }
      );
    }),
    timeout + 1_500,
    'LOCATION_TIMEOUT'
  );
}

/**
 * Precise fix, then a coarser cached fix. Same sequence on Android, iOS, and Web.
 * Permission denial stops the retry. A timeout still falls through to the coarse read.
 */
async function readPositionWithFallback(
  read: (enableHighAccuracy: boolean, timeout: number, maximumAge: number) => Promise<GeoCoordinates>
): Promise<GeoCoordinates> {
  try {
    return await read(true, HIGH_ACCURACY_MS, 5_000);
  } catch (error) {
    const code = locationFailureCode(error);
    if (code === 'LOCATION_PERMISSION_DENIED' || code === 'LOCATION_SERVICES_DISABLED') {
      throw coded(code);
    }
    if (code === 'GEOLOCATION_UNSUPPORTED') throw coded(code);
    try {
      return await read(false, COARSE_MS, 120_000);
    } catch (retryError) {
      const retryCode = locationFailureCode(retryError);
      if (
        retryCode === 'LOCATION_PERMISSION_DENIED' ||
        retryCode === 'LOCATION_SERVICES_DISABLED' ||
        retryCode === 'GEOLOCATION_UNSUPPORTED'
      ) {
        throw coded(retryCode);
      }
      throw coded('LOCATION_UNAVAILABLE');
    }
  }
}

/**
 * One-shot GPS fix for booking maps on Android, iOS, and the browser.
 * Waits up to 25s for the permission prompt, tries a precise fix, then a
 * coarser cached fix. Always settles so the map can fall back to Riyadh.
 */
export async function getCurrentPosition(): Promise<GeoCoordinates> {
  const allowed = await withTimeout(requestLocationPermission(), PERMISSION_MS, 'LOCATION_TIMEOUT');
  if (!allowed) {
    throw coded('LOCATION_PERMISSION_DENIED');
  }

  if (Capacitor.isNativePlatform()) {
    return readPositionWithFallback(readNativePosition);
  }
  return readPositionWithFallback(readBrowserPosition);
}

function usableCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function toCoordinates(
  lat: number,
  lng: number,
  heading: number | null | undefined,
  speed: number | null | undefined,
  accuracy: number | null | undefined
): GeoCoordinates {
  if (!usableCoordinate(lat, lng)) {
    throw coded('LOCATION_UNAVAILABLE');
  }
  return {
    lat,
    lng,
    heading: heading != null && Number.isFinite(heading) ? heading : undefined,
    speed: speed != null && Number.isFinite(speed) ? speed : undefined,
    accuracy: accuracy != null && Number.isFinite(accuracy) ? accuracy : undefined,
  };
}

function mapCapacitorPosition(position: Position): GeoCoordinates {
  return toCoordinates(
    position.coords.latitude,
    position.coords.longitude,
    position.coords.heading,
    position.coords.speed,
    position.coords.accuracy
  );
}

function mapWebPosition(position: GeolocationPosition): GeoCoordinates {
  return toCoordinates(
    position.coords.latitude,
    position.coords.longitude,
    position.coords.heading,
    position.coords.speed,
    position.coords.accuracy
  );
}

/** Start watching driver position — returns cleanup function. */
export function watchDriverPosition(
  onPosition: (coords: GeoCoordinates) => void,
  onError?: (error: unknown) => void
): () => void {
  if (Capacitor.isNativePlatform()) {
    let watchId: string | undefined;
    let stopped = false;

    // Do not pass a short timeout. The iOS plugin ends the watch when it fires,
    // which drops live tracking if the first GPS fix is slow.
    Geolocation.watchPosition(
      { enableHighAccuracy: true, maximumAge: 5000 },
      (position, err) => {
        if (stopped) return;
        if (err) {
          onError?.(err);
          return;
        }
        if (!position) return;
        try {
          onPosition(mapCapacitorPosition(position));
        } catch (error) {
          onError?.(error);
        }
      }
    )
      .then((id) => {
        watchId = id;
        if (stopped) {
          Geolocation.clearWatch({ id }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (!stopped) onError?.(error);
      });

    return () => {
      stopped = true;
      if (!watchId) return;
      const id = watchId;
      watchId = undefined;
      Geolocation.clearWatch({ id }).catch(() => undefined);
    };
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.(new Error('Geolocation not supported'));
    return () => undefined;
  }

  const id = navigator.geolocation.watchPosition(
    (pos) => {
      try {
        onPosition(mapWebPosition(pos));
      } catch (error) {
        onError?.(error);
      }
    },
    (err) => onError?.(err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 60_000 }
  );

  return () => navigator.geolocation.clearWatch(id);
}
