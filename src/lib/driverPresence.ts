/**
 * Driver online presence for nearest-match pricing / dispatch.
 * Collection: driver_presence/{uid}
 */

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, ensureFirebaseReady } from '@/lib/firebase';
import { getCurrentPosition } from '@/lib/geolocation';
import { isDevBypassAuthSession } from '@/lib/authApi';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  isValidSaudiServiceCoord,
  sanitizeWaterTankerDistanceKm,
} from '@/lib/waterTankerDistance';
import { haversineKm } from '@/lib/tripDistance';
import {
  canonicalizeServiceType,
  driverVehicleMatchesOrder,
} from '@/domain/serviceCategories';

export interface DriverPresence {
  uid: string;
  online: boolean;
  lat: number;
  lng: number;
  vehicleType: string;
  vehicleOption?: string;
  name?: string;
  phone?: string;
  updatedAt?: unknown;
}

export interface NearestDriverMatch {
  driverId: string | null;
  /** Geographic kilometers only — never tank liters. */
  distanceKm: number;
  driver?: DriverPresence | null;
  /** True when no live drivers were found and a mock km was used. */
  estimated: boolean;
}

export { haversineKm };

export async function publishDriverPresence(input: {
  uid: string;
  online: boolean;
  vehicleType: string;
  vehicleOption?: string;
  name?: string;
  phone?: string;
  coords?: { lat: number; lng: number } | null;
}): Promise<void> {
  await ensureFirebaseReady();

  const uid = auth.currentUser?.uid;
  if (!uid) {
    return;
  }

  let lat = input.coords?.lat;
  let lng = input.coords?.lng;

  if (input.online && (lat == null || lng == null)) {
    try {
      const pos = await getCurrentPosition();
      lat = pos.lat;
      lng = pos.lng;
    } catch (error) {
      console.warn('[driverPresence] could not get GPS while going online:', error);
    }
  }

  const hasValidCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    isValidSaudiServiceCoord(lat, lng);

  const canonicalVehicle =
    canonicalizeServiceType(input.vehicleType) || input.vehicleType || '';

  await setDoc(
    doc(db, 'driver_presence', uid),
    {
      uid,
      online: input.online,
      vehicleType: canonicalVehicle,
      ...(input.vehicleOption ? { vehicleOption: input.vehicleOption } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(hasValidCoords ? { lat, lng } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Find the nearest online driver whose vehicle type matches the service category.
 * Always returns a realistic kilometer distance (never tank capacity liters).
 */
export async function findNearestOnlineDriver(
  client: { lat: number; lng: number },
  serviceType: string
): Promise<NearestDriverMatch> {
  const mockKm = sanitizeWaterTankerDistanceKm(WATER_TANKER_MOCK_DISTANCE_KM);
  const wanted = canonicalizeServiceType(serviceType);

  if (isDevBypassAuthSession()) {
    return {
      driverId: 'dev-bypass-b2c-driver',
      distanceKm: mockKm,
      driver: {
        uid: 'dev-bypass-b2c-driver',
        online: true,
        lat: client.lat + 0.05,
        lng: client.lng + 0.04,
        vehicleType: wanted || serviceType,
        name: 'Dev Tanker Driver',
      },
      estimated: true,
    };
  }

  if (!wanted || !isValidSaudiServiceCoord(client.lat, client.lng)) {
    return {
      driverId: null,
      distanceKm: mockKm,
      driver: null,
      estimated: true,
    };
  }

  await ensureFirebaseReady();

  try {
    const snap = await getDocs(
      query(collection(db, 'driver_presence'), where('online', '==', true))
    );

    let best: NearestDriverMatch | null = null;

    snap.forEach((docSnap) => {
      const data = docSnap.data() as DriverPresence;
      if (!driverVehicleMatchesOrder(data.vehicleType, wanted)) return;
      if (!isValidSaudiServiceCoord(data.lat, data.lng)) return;

      const rawKm = haversineKm(client, { lat: data.lat, lng: data.lng });
      const distanceKm =
        wanted === 'water_tanker'
          ? sanitizeWaterTankerDistanceKm(rawKm, Number.POSITIVE_INFINITY)
          : rawKm;
      if (!Number.isFinite(distanceKm)) return;

      if (!best || distanceKm < best.distanceKm) {
        best = {
          driverId: docSnap.id,
          distanceKm,
          driver: { ...data, uid: docSnap.id },
          estimated: false,
        };
      }
    });

    if (best) return best;
  } catch (error) {
    console.warn('[driverPresence] nearest-driver query failed:', error);
  }

  return {
    driverId: null,
    distanceKm: mockKm,
    driver: null,
    estimated: true,
  };
}
