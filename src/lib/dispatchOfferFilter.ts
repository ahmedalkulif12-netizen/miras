import { haversineKm } from '@/lib/tripDistance';
import {
  driverMatchesRequiredVehicle,
  resolveOrderRequiredVehicleType,
  resolveOrderServiceOption,
} from '@/domain/serviceCategories';
import { vehicleMatchesService } from '@/lib/fleetServiceCatalog';
import {
  DISPATCH_EXPANDED_RADIUS_KM,
  DISPATCH_MAX_RADIUS_KM,
  orderDispatchCity,
  orderDispatchPoint,
  orderDispatchStartedAt,
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
    tripType?: string;
    pickupLat?: number;
    pickupLng?: number;
    pickupCity?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    dropoffCity?: string;
    deliveryOnly?: boolean;
    locationMode?: string;
    pickupCoords?: { lat?: number; lng?: number };
    dropoffCoords?: { lat?: number; lng?: number };
    destinationCoords?: { lat?: number; lng?: number };
    serviceOption?: string;
    serviceDetails?: {
      type?: string;
      option?: string;
      serviceOption?: string;
      capacity?: string;
    };
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
    vehicleOption?: string;
  };
  nowMs?: number;
  /** Localhost: still hide other cities, but allow missing GPS. */
  relaxMissingGps?: boolean;
  /** Localhost: do not hide offers that are outside the expanding radius. */
  relaxRadius?: boolean;
}): DispatchOfferDecision {
  const window = resolveDispatchWindow(orderDispatchStartedAt(input.order), input.nowMs);
  const pickup = orderDispatchPoint(input.order);
  const driverLat = Number(input.driver.lat);
  const driverLng = Number(input.driver.lng);
  const hasDriverGps = Number.isFinite(driverLat) && Number.isFinite(driverLng);
  const tripType = String(input.order.tripType || '');

  if (!sameDispatchCity(orderDispatchCity(input.order), input.driver.city)) {
    return { visible: false, distanceKm: null, window, reason: 'cross_city' };
  }

  const requiredService =
    resolveOrderRequiredVehicleType(input.order) || input.order.serviceType || '';
  const requiredOption = resolveOrderServiceOption(input.order) || undefined;
  const categoryOk = driverMatchesRequiredVehicle(input.driver.vehicleType, input.order);
  const subtypeOk = vehicleMatchesService(
    {
      serviceType: input.driver.vehicleType,
      category: input.driver.vehicleType,
      serviceOption: input.driver.vehicleOption,
      subtype: input.driver.vehicleOption,
    },
    requiredService,
    requiredOption
  );
  if (!subtypeOk) {
    return {
      visible: false,
      distanceKm: null,
      window,
      reason: categoryOk ? 'subtype' : 'vehicle',
    };
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
    // Expanded search may cover a wide metro (Al-Ahsa) but never another city.
    // A driver in Riyadh must not see a pickup in Dammam.
    const expandedCap =
      input.relaxRadius || window.atMax || tripType === 'outside_city'
        ? DISPATCH_EXPANDED_RADIUS_KM
        : cap;
    if (distanceKm <= expandedCap && expandedCap > cap) {
      return {
        visible: true,
        distanceKm,
        window,
        reason: window.atMax ? 'outside_radius_at_max' : 'outside_radius_relaxed',
      };
    }
    return { visible: false, distanceKm, window, reason: 'outside_radius' };
  }

  return { visible: true, distanceKm, window };
}
