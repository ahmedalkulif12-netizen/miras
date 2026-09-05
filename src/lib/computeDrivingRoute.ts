/**
 * Driving distance for booking quotes.
 * Prefer classic DirectionsService (reliable in this Maps key setup),
 * then haversine × road factor so Al-Ahsa → Makkah never hard-fails.
 */

import { haversineKm, roundKm } from './tripDistance';

export type LatLngLiteral = { lat: number; lng: number };

export function isValidRoutePoint(
  point: LatLngLiteral | null | undefined
): point is LatLngLiteral {
  if (!point) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export type DrivingRouteResult = {
  distanceKm: number;
  distanceMeters: number;
  usedFallback: boolean;
};

function roadEstimateKm(origin: LatLngLiteral, destination: LatLngLiteral): number {
  const straight = haversineKm(origin, destination);
  return roundKm(Math.max(straight * 1.2, 0.1));
}

function directionsDistanceMeters(
  origin: LatLngLiteral,
  destination: LatLngLiteral
): Promise<number | null> {
  if (typeof google === 'undefined' || !google.maps?.DirectionsService) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const service = new google.maps.DirectionsService();
    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result?.routes?.[0]) {
          resolve(null);
          return;
        }
        const meters = result.routes[0].legs?.reduce(
          (sum, leg) => sum + (leg.distance?.value || 0),
          0
        );
        resolve(meters && meters > 0 ? meters : null);
      }
    );
  });
}

/**
 * Billable driving distance between two pins.
 * Never throws for valid coordinates — falls back to a road-adjusted haversine.
 */
export async function computeDrivingRoute(
  origin: LatLngLiteral,
  destination: LatLngLiteral
): Promise<DrivingRouteResult> {
  if (!isValidRoutePoint(origin) || !isValidRoutePoint(destination)) {
    throw new Error('INVALID_COORDINATES');
  }

  try {
    const meters = await directionsDistanceMeters(origin, destination);
    if (meters && meters > 0) {
      return {
        distanceKm: roundKm(meters / 1000),
        distanceMeters: meters,
        usedFallback: false,
      };
    }
  } catch (error) {
    console.warn('[route] DirectionsService failed — using distance fallback:', error);
  }

  const km = roadEstimateKm(origin, destination);
  return {
    distanceKm: km,
    distanceMeters: Math.round(km * 1000),
    usedFallback: true,
  };
}
