import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { requestLocationPermission, watchDriverPosition, type GeoCoordinates } from '@/lib/geolocation';

/** Single canonical doc for latest driver GPS (orders/{orderId}/tracking/live). */
export const LIVE_TRACKING_DOC_ID = 'live';

export interface LiveDriverPosition {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  updatedAt?: unknown;
}

let stopWatch: (() => void) | null = null;
let lastWriteMs = 0;
const MIN_WRITE_INTERVAL_MS = 4000;

export function parseLiveDriverPosition(
  data: Record<string, unknown> | null | undefined
): LiveDriverPosition | null {
  if (!data) return null;
  const lat = Number(data.lat ?? data.driverLat ?? data.latitude);
  const lng = Number(data.lng ?? data.driverLng ?? data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  const heading = data.heading != null ? Number(data.heading) : undefined;
  const speed = data.speed != null ? Number(data.speed) : undefined;
  return {
    lat,
    lng,
    heading: heading != null && Number.isFinite(heading) ? heading : undefined,
    speed: speed != null && Number.isFinite(speed) ? speed : undefined,
    updatedAt: data.updatedAt ?? data.driverLocationUpdatedAt,
  };
}

/**
 * Customer-side: subscribe to live driver position via Firestore snapshot.
 * Rules allow read for order customer + assigned driver (see firestore.rules).
 */
export function subscribeToDriverLocation(
  orderId: string,
  onUpdate: (position: LiveDriverPosition | null) => void
): () => void {
  const trackingRef = doc(db, 'orders', orderId, 'tracking', LIVE_TRACKING_DOC_ID);
  let unsub: (() => void) | undefined;
  let cancelled = false;

  void ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsub = onSnapshot(
      trackingRef,
      (snap) => {
        if (!snap.exists()) {
          onUpdate(null);
          return;
        }
        const parsed = parseLiveDriverPosition(snap.data() as Record<string, unknown>);
        onUpdate(parsed);
      },
      (error) => {
        console.warn('[liveTracking] subscribe failed:', error);
        onUpdate(null);
      }
    );
  });

  return () => {
    cancelled = true;
    unsub?.();
  };
}

async function publishPosition(
  orderId: string,
  driverId: string,
  coords: GeoCoordinates
): Promise<void> {
  const now = Date.now();
  if (now - lastWriteMs < MIN_WRITE_INTERVAL_MS) return;
  lastWriteMs = now;

  await ensureFirebaseReady();

  const trackingWrite = setDoc(
    doc(db, 'orders', orderId, 'tracking', LIVE_TRACKING_DOC_ID),
    {
      driverId,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // Mirror coords onto the order so the customer snapshot has a fallback
  // if the tracking/live listener is delayed or denied.
  const orderWrite = updateDoc(doc(db, 'orders', orderId), {
    driverLat: coords.lat,
    driverLng: coords.lng,
    driverLocationUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch((error) => {
    console.warn('[liveTracking] order GPS mirror failed:', error);
  });

  await Promise.all([trackingWrite, orderWrite]);
}

/**
 * Driver-side: publish GPS to Firestore while on an active trip.
 * Throttled writes protect battery and Firestore quota.
 */
export async function startDriverLocationBroadcast(
  orderId: string,
  driverId: string
): Promise<void> {
  await stopDriverLocationBroadcast();

  const granted = await requestLocationPermission();
  if (!granted) {
    throw new Error('LOCATION_PERMISSION_DENIED');
  }

  stopWatch = watchDriverPosition(
    (coords) => {
      publishPosition(orderId, driverId, coords).catch((err) =>
        console.warn('[liveTracking] publish failed:', err)
      );
    },
    (err) => console.warn('[liveTracking] watch error:', err)
  );
}

export async function stopDriverLocationBroadcast(): Promise<void> {
  stopWatch?.();
  stopWatch = null;
  lastWriteMs = 0;
}
