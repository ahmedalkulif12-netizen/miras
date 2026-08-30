/**
 * Water-tanker distance helpers.
 * Tank capacity (1000L–12000L) must NEVER enter kilometer math.
 */

import {
  WATER_TANKER_INCLUDED_KM,
  normalizeWaterTankerCapacity,
} from '@/lib/pricingDefaults';
import { WATER_CAPACITY_LITER_VALUES } from '@/lib/waterTankerCatalog';

/** Capacity liter amounts that must never be treated as kilometers. */
const CAPACITY_LITER_VALUES = new Set(WATER_CAPACITY_LITER_VALUES);

/** Realistic mock km when no valid nearest-driver fix is available (5–15). */
export const WATER_TANKER_MOCK_DISTANCE_KM = 10;

/** Hard ceiling for a sane driver→client quote inside Saudi service area. */
export const WATER_TANKER_MAX_DISTANCE_KM = 250;

export function isLikelyTankCapacityAsKm(value: number): boolean {
  if (!Number.isFinite(value)) return true;
  const rounded = Math.round(value);
  return CAPACITY_LITER_VALUES.has(rounded);
}

export function isValidSaudiServiceCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Reject null-island / uninitialized presence writes.
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return false;
  // Rough Saudi bounding box (with margin).
  return lat >= 16 && lat <= 33 && lng >= 34 && lng <= 56;
}

/**
 * Normalize a candidate driver→client distance for water tanker pricing.
 * Rejects liter-as-km values and absurd geographic outliers.
 */
export function sanitizeWaterTankerDistanceKm(
  candidateKm: number,
  fallbackKm: number = WATER_TANKER_MOCK_DISTANCE_KM
): number {
  if (!Number.isFinite(candidateKm) || candidateKm < 0) {
    return fallbackKm;
  }
  if (isLikelyTankCapacityAsKm(candidateKm)) {
    console.warn(
      '[waterTanker] rejected capacity-like value used as km:',
      candidateKm
    );
    return fallbackKm;
  }
  if (candidateKm > WATER_TANKER_MAX_DISTANCE_KM) {
    console.warn(
      '[waterTanker] rejected unrealistically large driver distance km:',
      candidateKm
    );
    return fallbackKm;
  }
  return Math.round(candidateKm * 10) / 10;
}

export function waterTankerExtraKm(
  distanceKm: number,
  includedKm: number = WATER_TANKER_INCLUDED_KM
): number {
  const safe = sanitizeWaterTankerDistanceKm(distanceKm);
  return Math.max(0, Math.round((safe - includedKm) * 10) / 10);
}

export function resolveTankCapacityLabel(raw: string | null | undefined): string {
  return normalizeWaterTankerCapacity(raw);
}
