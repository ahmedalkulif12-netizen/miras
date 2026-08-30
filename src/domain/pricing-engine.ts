/**
 * Pure trip fare calculation (distance + service tier config).
 * No Firebase or HTTP — safe to use on client for previews and on server for authority.
 *
 * Universal formula (all 6 services):
 *   tripFare = basePrice + max(0, totalDistanceKm - 25) * extraKmRate
 *
 * Client pays tripFare + 5% service fee (financials.ts).
 * Driver receives tripFare − 15% platform commission (financials.ts).
 */

import {
  INCLUDED_KM,
  WATER_TANKER_INCLUDED_KM,
  normalizeServiceType,
  normalizeWaterTankerCapacity,
  resolveTierKey,
  resolveTierRate,
} from '../lib/pricingDefaults';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  sanitizeWaterTankerDistanceKm,
} from '../lib/waterTankerDistance';
import {
  normalizeWaterServiceType,
  waterTypeMultiplier,
} from '../lib/waterTankerCatalog';

export interface PricingConfigInput {
  base_price?: number;
  price_per_km?: number;
  free_km?: number;
  included_km?: number;
  max_price?: number;
  min_price?: number;
  minimum_price?: number;
  heavy_multiplier?: number;
  cold_multiplier?: number;
  hydraulic_multiplier?: number;
  surge_multiplier?: number;
  capacity_prices?: Record<string, number>;
  tier_prices?: Record<string, { base_price: number; price_per_km: number }>;
}

export interface ComputeTripFareParams {
  /** Road / driver-to-client distance in kilometers (never tank liters or tons). */
  distance: number;
  serviceType: string;
  /**
   * Vehicle / capacity tier key (e.g. small_truck, hydraulic, 1000L, light_equip).
   * Preferred over truckType for all services.
   */
  option?: string;
  /** @deprecated Prefer `option`. Flatbed hydraulic/normal only. */
  truckType?: 'normal' | 'hydraulic' | 'box' | string;
  truckCount?: number;
  /** Water tanker capacity label, e.g. "1000L" — never used as distance. */
  capacity?: string;
  /** Water quality / job type: fresh | normal | sewage. */
  waterType?: string;
}

export interface ComputeTripFareResult {
  tripFare: number;
  base: number;
  extraKmCost: number;
  rate: number;
  surgeApplied: boolean;
  isPriceCapApplied: boolean;
  tripType: 'inside_city' | 'outside_city';
  /** Kilometers included in the base price. */
  includedKm: number;
  /** Billable km beyond included radius. */
  extraKm: number;
  /** Resolved tier key used for base + rate. */
  tier: string;
  /** Water tanker: normalized capacity used for base price. */
  capacity?: string;
  /** Water tanker: normalized water service type. */
  waterType?: string;
}

export function computeTripFare(
  pricing: PricingConfigInput,
  params: ComputeTripFareParams
): ComputeTripFareResult {
  const {
    distance,
    serviceType,
    option,
    truckType = 'normal',
    truckCount = 1,
    capacity,
    waterType,
  } = params;

  const service = normalizeServiceType(serviceType);
  let safeDistance = Number(distance) || 0;

  if (service === 'water_tanker') {
    safeDistance = sanitizeWaterTankerDistanceKm(
      safeDistance,
      WATER_TANKER_MOCK_DISTANCE_KM
    );
  }

  const tripType = safeDistance > 100 ? 'outside_city' : 'inside_city';

  const tierKey = resolveTierKey(service, option || capacity, {
    capacity,
    truckType: option || truckType,
  });

  const tierRate = resolveTierRate(service, tierKey, pricing);
  const typeMult =
    service === 'water_tanker' ? waterTypeMultiplier(waterType) : 1;
  const resolvedWaterType =
    service === 'water_tanker' ? normalizeWaterServiceType(waterType) : undefined;

  let base = Math.round(tierRate.base_price * typeMult * 100) / 100;
  let rate = Math.round((Number(tierRate.price_per_km) || 0) * typeMult * 1000) / 1000;

  // Always 25 km included — never inherit stale free_km: 5 from legacy docs.
  const includedKm =
    typeof pricing.included_km === 'number' && pricing.included_km > 0
      ? pricing.included_km
      : typeof pricing.free_km === 'number' && pricing.free_km >= INCLUDED_KM
        ? pricing.free_km
        : INCLUDED_KM;

  const extraKm = Math.max(0, Math.round((safeDistance - includedKm) * 10) / 10);
  const extraKmCost = Math.round(extraKm * rate * 100) / 100;
  let tripFare = Math.round((base + extraKmCost) * 100) / 100;

  // Optional multi-truck for cargo only (operational), applied after base formula.
  if ((service === 'goods_transport' || serviceType === 'cargo') && truckCount > 1) {
    tripFare = Math.round(tripFare * truckCount * 100) / 100;
  }

  const surgeMultiplier = pricing.surge_multiplier || 1.0;
  const surgeApplied = surgeMultiplier > 1.0;
  if (surgeApplied) {
    tripFare = Math.round(tripFare * surgeMultiplier * 100) / 100;
  }

  // Line-item invariant: visible fare components must sum to tripFare (pre-surge / truck).
  // When surge or truckCount applied, tripFare may exceed base+extraKmCost intentionally.
  const capacityKey =
    service === 'water_tanker'
      ? normalizeWaterTankerCapacity(option || capacity || tierRate.tier)
      : undefined;

  return {
    tripFare: Math.round(tripFare * 100) / 100,
    base,
    extraKmCost,
    rate,
    surgeApplied,
    isPriceCapApplied: false,
    tripType,
    includedKm,
    extraKm,
    tier: tierRate.tier,
    capacity: capacityKey,
    ...(resolvedWaterType ? { waterType: resolvedWaterType } : {}),
  };
}

/** @deprecated Use INCLUDED_KM from pricingDefaults. */
export { WATER_TANKER_INCLUDED_KM };
