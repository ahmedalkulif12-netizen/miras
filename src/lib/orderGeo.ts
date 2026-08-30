import type { Order } from '@/types';
import { cityCenterFromName } from '@/lib/cityCoordinates';

export type LatLng = { lat: number; lng: number };

/** Rough Earth distance in km (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize any common Firestore / client lat-lng shape:
 * `{ lat, lng }`, `{ latitude, longitude }`, GeoPoint-like, or `[lng, lat]` / `[lat, lng]`.
 */
export function coerceLatLng(value: unknown): LatLng | null {
  if (value == null) return null;

  if (Array.isArray(value) && value.length >= 2) {
    const a = asFiniteNumber(value[0]);
    const b = asFiniteNumber(value[1]);
    if (a == null || b == null) return null;
    // Prefer [lat, lng] when first looks like latitude; else treat as GeoJSON [lng, lat].
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lng: b };
    }
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
      return { lat: b, lng: a };
    }
    return null;
  }

  if (typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  // Firestore GeoPoint
  if (typeof (obj as { toJSON?: () => unknown }).toJSON === 'function') {
    try {
      const json = (obj as { toJSON: () => unknown }).toJSON();
      const nested = coerceLatLng(json);
      if (nested) return nested;
    } catch {
      /* ignore */
    }
  }

  const lat = asFiniteNumber(obj.lat ?? obj.latitude);
  const lng = asFiniteNumber(obj.lng ?? obj.longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Reject null-island / empty placeholders
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function fromFlatPickup(order: Order): LatLng | null {
  return coerceLatLng({ lat: order.pickupLat, lng: order.pickupLng });
}

function fromFlatDropoff(order: Order): LatLng | null {
  return coerceLatLng({ lat: order.dropoffLat, lng: order.dropoffLng });
}

function fromNestedPickup(order: Order): LatLng | null {
  return coerceLatLng(order.pickup);
}

function fromNestedDropoff(order: Order): LatLng | null {
  return coerceLatLng(order.destination);
}

function fromLegacyPickup(order: Order): LatLng | null {
  return coerceLatLng(order.pickupCoords);
}

function fromLegacyDropoff(order: Order): LatLng | null {
  return coerceLatLng(order.destinationCoords);
}

type CoordPair = { pickup: LatLng; dropoff: LatLng; source: string };

/**
 * Build candidate pickup/dropoff pairs from every supported field shape.
 * When `distanceKm` is present, prefer the pair whose straight-line distance
 * best matches the saved trip distance (avoids stale city-center / wrong-field coords).
 */
function collectCoordPairs(order: Order): CoordPair[] {
  const pickups: Array<{ point: LatLng; source: string }> = [];
  const dropoffs: Array<{ point: LatLng; source: string }> = [];

  const pushUnique = (
    list: Array<{ point: LatLng; source: string }>,
    point: LatLng | null,
    source: string
  ) => {
    if (!point) return;
    if (list.some((e) => Math.abs(e.point.lat - point.lat) < 1e-6 && Math.abs(e.point.lng - point.lng) < 1e-6)) {
      return;
    }
    list.push({ point, source });
  };

  // Prefer denormalized fields written by createOrder, then nested GeoLocation, then legacy *Coords.
  pushUnique(pickups, fromFlatPickup(order), 'flat');
  pushUnique(pickups, fromNestedPickup(order), 'nested');
  pushUnique(pickups, fromLegacyPickup(order), 'legacy');

  pushUnique(dropoffs, fromFlatDropoff(order), 'flat');
  pushUnique(dropoffs, fromNestedDropoff(order), 'nested');
  pushUnique(dropoffs, fromLegacyDropoff(order), 'legacy');

  const pairs: CoordPair[] = [];
  for (const p of pickups) {
    for (const d of dropoffs) {
      // Same source pairing first priority via sort below; still collect mixed.
      pairs.push({
        pickup: p.point,
        dropoff: d.point,
        source: `${p.source}+${d.source}`,
      });
    }
  }
  return pairs;
}

function scorePair(pair: CoordPair, expectedKm: number | null): number {
  const straight = haversineKm(pair.pickup, pair.dropoff);
  // Identical endpoints are useless for a route preview.
  if (straight < 0.05) return Number.POSITIVE_INFINITY;

  let score = 0;
  // Prefer matching sources (flat+flat, nested+nested, …)
  if (pair.source === 'flat+flat') score -= 5;
  else if (pair.source === 'nested+nested') score -= 3;
  else if (pair.source === 'legacy+legacy') score -= 1;

  if (expectedKm != null && expectedKm > 0) {
    // Driving distance is usually ~1.1–1.4× straight line for city trips.
    const expectedStraight = expectedKm / 1.25;
    score += Math.abs(straight - expectedStraight);
    // Heavy penalty when pair implies a country-scale trip but order says local.
    if (expectedKm <= 40 && straight > expectedKm * 4 + 30) {
      score += 500;
    }
  } else {
    score += straight * 0.01;
  }
  return score;
}

export function getOrderTripCoordinates(order: Order | null | undefined): {
  pickup: LatLng | null;
  dropoff: LatLng | null;
} {
  if (!order) return { pickup: null, dropoff: null };

  const expectedRaw = Number(order.distanceKm ?? order.distance);
  const expectedKm = Number.isFinite(expectedRaw) && expectedRaw > 0 ? expectedRaw : null;

  const pairs = collectCoordPairs(order);
  if (pairs.length === 0) {
    return {
      pickup: fromFlatPickup(order) || fromNestedPickup(order) || fromLegacyPickup(order),
      dropoff: fromFlatDropoff(order) || fromNestedDropoff(order) || fromLegacyDropoff(order),
    };
  }

  pairs.sort((a, b) => scorePair(a, expectedKm) - scorePair(b, expectedKm));
  const best = pairs[0];
  return { pickup: best.pickup, dropoff: best.dropoff };
}

function readPlaceCity(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const obj = value as { city?: unknown; address?: unknown };
    if (typeof obj.city === 'string' && obj.city.trim()) return obj.city.trim();
    if (typeof obj.address === 'string' && obj.address.trim()) return obj.address.trim();
  }
  return '';
}

/** Customer pickup city / address text used when lat/lng are missing. */
export function orderCustomerCityName(order: Order | null | undefined): string {
  if (!order) return '';
  return (
    String(order.pickupCity || '').trim() ||
    readPlaceCity(order.pickup) ||
    String(order.pickupAddress || '').trim()
  );
}

/** Drop-off city / address text used when lat/lng are missing. */
export function orderDropoffCityName(order: Order | null | undefined): string {
  if (!order) return '';
  return (
    String(order.dropoffCity || '').trim() ||
    readPlaceCity(order.destination) ||
    String(order.dropoffAddress || '').trim()
  );
}

/**
 * Map endpoints for the driver dashboard.
 * Prefer saved lat/lng; if missing/invalid, route customer city ↔ driver city/GPS.
 */
export function resolveDriverMapEndpoints(
  order: Order | null | undefined,
  fallbacks?: { driverPos?: LatLng | null; driverCity?: string | null }
): {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  usedCityFallback: boolean;
  customerCity: string;
  dropoffCity: string;
} {
  const exact = getOrderTripCoordinates(order);
  if (!order) {
    return {
      pickup: null,
      dropoff: null,
      usedCityFallback: false,
      customerCity: '',
      dropoffCity: '',
    };
  }

  const customerCity = orderCustomerCityName(order);
  const dropoffCity = orderDropoffCityName(order);
  const customerCityPoint = cityCenterFromName(customerCity);
  const dropoffCityPoint = cityCenterFromName(dropoffCity);
  const driverCityPoint = cityCenterFromName(fallbacks?.driverCity || '');
  const driverPos = fallbacks?.driverPos || null;
  const driverPoint = driverPos || driverCityPoint;

  let pickup = exact.pickup || customerCityPoint || driverPoint;
  let dropoff = exact.dropoff || dropoffCityPoint || driverPoint || customerCityPoint;

  // Both order coords missing: customer city → driver's current city/GPS.
  if (!exact.pickup && !exact.dropoff && customerCityPoint && driverPoint) {
    pickup = customerCityPoint;
    dropoff = driverPoint;
  }

  return {
    pickup,
    dropoff,
    usedCityFallback: Boolean((!exact.pickup || !exact.dropoff) && (pickup || dropoff)),
    customerCity,
    dropoffCity,
  };
}

export function getOrderPickupLatLng(order: Order | null | undefined): LatLng | null {
  return getOrderTripCoordinates(order).pickup;
}

export function getOrderDropoffLatLng(order: Order | null | undefined): LatLng | null {
  return getOrderTripCoordinates(order).dropoff;
}

/** True when `point` is within `maxKm` of either trip endpoint. */
export function isNearTripEndpoints(
  point: LatLng,
  pickup: LatLng,
  dropoff: LatLng,
  maxKm = 40
): boolean {
  return haversineKm(point, pickup) <= maxKm || haversineKm(point, dropoff) <= maxKm;
}
