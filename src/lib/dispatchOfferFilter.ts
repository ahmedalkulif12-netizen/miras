import { haversineKm } from '@/lib/tripDistance';
import { driverMatchesRequiredVehicle } from '@/domain/serviceCategories';
import {
  DISPATCH_MAX_RADIUS_KM,
  orderDispatchCity,
  orderDispatchStartedAt,
  orderPickupPoint,
  resolveDispatchWindow,
  sameDispatchCity,
  type DispatchWindow,
} from '@/domain/dispatchMatching';

export interface DispatchOfferDecision {
  visible: boolean;
  distanceKm: number | null;
  window: DispatchWindow;
  reason?: string;
}

export function evaluateDispatchOffer(input: {
  order: {
    status?: string;
    serviceType?: string;
    requiredVehicleType?: string;
    truckType?: string;
    pickupLat?: number;
    pickupLng?: number;
    pickupCity?: string;
    pickupCoords?: { lat?: number; lng?: number };
    pickup?: { lat?: number; lng?: number; city?: string };
    dispatch?: { startedAt?: unknown; city?: string; cityKey?: string };
    createdAt?: unknown;
    promotedAt?: unknown;
  };
  driver: {
    lat?: number;
    lng?: number;
    city?: string;
    vehicleType?: string;
  };
  nowMs?: number;
  /** Localhost: still hide other cities, but allow missing GPS. */
  relaxMissingGps?: boolean;
  /** Localhost: do not hide offers that are outside the expanding radius. */
  relaxRadius?: boolean;
}): DispatchOfferDecision {
  const window = resolveDispatchWindow(orderDispatchStartedAt(input.order), input.nowMs);
  const pickup = orderPickupPoint(input.order);
  const driverLat = Number(input.driver.lat);
  const driverLng = Number(input.driver.lng);
  const hasDriverGps = Number.isFinite(driverLat) && Number.isFinite(driverLng);

  if (!sameDispatchCity(orderDispatchCity(input.order), input.driver.city)) {
    return { visible: false, distanceKm: null, window, reason: 'cross_city' };
  }

  if (!driverMatchesRequiredVehicle(input.driver.vehicleType, input.order)) {
    return { visible: false, distanceKm: null, window, reason: 'vehicle' };
  }

  if (!pickup) {
    return {
      visible: Boolean(input.relaxMissingGps),
      distanceKm: null,
      window,
      reason: pickup ? undefined : 'no_pickup',
    };
  }

  if (!hasDriverGps) {
    return {
      visible: Boolean(input.relaxMissingGps),
      distanceKm: null,
      window,
      reason: 'no_driver_gps',
    };
  }

  const distanceKm = haversineKm(pickup, { lat: driverLat, lng: driverLng });
  const cap = Math.min(window.radiusKm, DISPATCH_MAX_RADIUS_KM);
  if (distanceKm > cap) {
    if (input.relaxRadius) {
      return { visible: true, distanceKm, window, reason: 'outside_radius_relaxed' };
    }
    return { visible: false, distanceKm, window, reason: 'outside_radius' };
  }

  return { visible: true, distanceKm, window };
}
