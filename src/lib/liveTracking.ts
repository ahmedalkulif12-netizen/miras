import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
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
        const data = snap.data() as Record<string, unknown>;
        const lat = Number(data.lat);
        const lng = Number(data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          onUpdate(null);
          return;
        }
        if (lat === 0 && lng === 0) {
          onUpdate(null);
          return;
        }
        onUpdate({
          lat,
          lng,
          heading: data.heading != null ? Number(data.heading) : undefined,
          speed: data.speed != null ? Number(data.speed) : undefined,
          updatedAt: data.updatedAt,
        });
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

  await setDoc(
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
