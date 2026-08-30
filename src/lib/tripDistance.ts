/**
 * Trip distance from exact coordinates.
 * Prefer road distance (Google Routes meters); fall back to haversine.
 */

/** Haversine great-circle distance in kilometers (0.1 km precision). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return roundKm(km);
}

/** Meters → km at 0.1 km precision (never integer-only rounding). */
export function metersToKm(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 0;
  return roundKm(distanceMeters / 1000);
}

export function roundKm(km: number): number {
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round(km * 10) / 10;
}

/**
 * Billable trip distance between pickup and dropoff.
 * Uses road meters when provided; otherwise haversine on exact coords.
 */
export function tripDistanceKm(input: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  /** Google Routes (or similar) distance in meters when available. */
  roadDistanceMeters?: number | null;
  /** Minimum billable km (avoids zero for same-building pin). */
  minimumKm?: number;
}): number {
  const minKm = input.minimumKm ?? 0.1;
  let km = 0;

  if (
    typeof input.roadDistanceMeters === 'number' &&
    Number.isFinite(input.roadDistanceMeters) &&
    input.roadDistanceMeters > 0
  ) {
    km = metersToKm(input.roadDistanceMeters);
  } else {
    km = haversineKm(input.pickup, input.dropoff);
  }

  // Identical pins → still bill a tiny minimum so fare math stays valid.
  if (km < minKm) return minKm;
  return km;
}
