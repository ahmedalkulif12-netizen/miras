import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

export interface GeoCoordinates {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

/**
 * Request location permission (Capacitor native + browser).
 * Web browsers prompt on first watchPosition/getCurrentPosition call.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
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

/**
 * One-shot live GPS fix for booking maps (customer current location).
 * Requests permission first, then returns high-accuracy coordinates.
 */
export async function getCurrentPosition(): Promise<GeoCoordinates> {
  const allowed = await requestLocationPermission();
  if (!allowed) {
    throw Object.assign(new Error('LOCATION_PERMISSION_DENIED'), {
      code: 'LOCATION_PERMISSION_DENIED',
    });
  }

  if (Capacitor.isNativePlatform()) {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });
    return mapCapacitorPosition(position);
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw Object.assign(new Error('GEOLOCATION_UNSUPPORTED'), {
      code: 'GEOLOCATION_UNSUPPORTED',
    });
  }

  return new Promise<GeoCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(mapWebPosition(pos)),
      (err) =>
        reject(
          Object.assign(new Error(err.message || 'GEOLOCATION_FAILED'), {
            code: err.code === 1 ? 'LOCATION_PERMISSION_DENIED' : 'GEOLOCATION_FAILED',
          })
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}

function mapCapacitorPosition(position: Position): GeoCoordinates {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    heading: position.coords.heading ?? undefined,
    speed: position.coords.speed ?? undefined,
    accuracy: position.coords.accuracy,
  };
}

function mapWebPosition(position: GeolocationPosition): GeoCoordinates {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    heading: position.coords.heading ?? undefined,
    speed: position.coords.speed ?? undefined,
    accuracy: position.coords.accuracy,
  };
}

/** Start watching driver position — returns cleanup function. */
export function watchDriverPosition(
  onPosition: (coords: GeoCoordinates) => void,
  onError?: (error: unknown) => void
): () => void {
  if (Capacitor.isNativePlatform()) {
    let watchId: string | undefined;

    Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
      (position, err) => {
        if (err) {
          onError?.(err);
          return;
        }
        if (position) onPosition(mapCapacitorPosition(position));
      }
    ).then((id) => {
      watchId = id;
    });

    return () => {
      if (watchId) Geolocation.clearWatch({ id: watchId }).catch(() => undefined);
    };
  }

  if (!navigator.geolocation) {
    onError?.(new Error('Geolocation not supported'));
    return () => undefined;
  }

  const id = navigator.geolocation.watchPosition(
    (pos) => onPosition(mapWebPosition(pos)),
    (err) => onError?.(err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  return () => navigator.geolocation.clearWatch(id);
}
