/**
 * Flatbed tariff. Distance is the driving kilometers between the customer's
 * pickup and drop-off — never a fixed city such as Al-Ahsa.
 *
 * Workshop and industrial trips: base price covers the included kilometers,
 * then a rate for each kilometer beyond that. Google driving distance is the input.
 * Taqdeer stays a fixed same-city price. Other long trips use the inter-city rate.
 * Damaged tires add the configured surcharge.
 */

import { cityCenterFromName } from '../lib/cityCoordinates';

export const INTRA_CITY_SERVICES = ['workshop', 'general', 'industrial', 'taqdeer'] as const;
export type IntraCityService = (typeof INTRA_CITY_SERVICES)[number];

export interface FlatbedOffsets {
  hydraulic: number;
  normal: number;
  box: number;
}

export interface IntraCityPrices {
  workshop: number;
  general: number;
  industrial: number;
  taqdeer: number;
}

export interface FlatbedTariff {
  intercityBaseFee: number;
  intercityRatePerKm: number;
  intercityMinimumFare: number;
  sameCityRadiusKm: number;
  offsetFloor: number;
  tireDamageSurcharge: number;
  /** Workshop and industrial base fare. Covers intraIncludedKm. */
  intraBasePrice: number;
  /** Kilometers included in intraBasePrice. */
  intraIncludedKm: number;
  /** SAR per km after intraIncludedKm for workshop and industrial trips. */
  intraExtraKmRate: number;
  offsets: FlatbedOffsets;
  intraCity: IntraCityPrices;
}

export const DEFAULT_FLATBED_TARIFF: FlatbedTariff = {
  intercityBaseFee: 70,
  intercityRatePerKm: 2.2,
  intercityMinimumFare: 350,
  sameCityRadiusKm: 40,
  offsetFloor: 50,
  tireDamageSurcharge: 100,
  intraBasePrice: 150,
  intraIncludedKm: 25,
  intraExtraKmRate: 1.5,
  offsets: { hydraulic: 0, normal: -100, box: 250 },
  intraCity: { workshop: 70, general: 100, industrial: 150, taqdeer: 250 },
};

function money(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

function nonNegative(value: unknown, fallback: number): number {
  return Math.max(0, money(value, fallback));
}

export function readFlatbedTariff(source: unknown): FlatbedTariff {
  const row =
    source && typeof source === 'object'
      ? ((source as { flatbed_tariff?: unknown }).flatbed_tariff &&
        typeof (source as { flatbed_tariff?: unknown }).flatbed_tariff === 'object'
          ? ((source as { flatbed_tariff: Record<string, unknown> }).flatbed_tariff)
          : (source as Record<string, unknown>))
      : {};
  const offsets = (row.offsets || {}) as Record<string, unknown>;
  const intra = (row.intraCity || row.intra_city || {}) as Record<string, unknown>;
  const defaults = DEFAULT_FLATBED_TARIFF;
  return {
    intercityBaseFee: nonNegative(row.intercityBaseFee ?? row.intercity_base_fee, defaults.intercityBaseFee),
    intercityRatePerKm: nonNegative(
      row.intercityRatePerKm ?? row.intercity_rate_per_km,
      defaults.intercityRatePerKm
    ),
    intercityMinimumFare: nonNegative(
      row.intercityMinimumFare ?? row.intercity_minimum_fare,
      defaults.intercityMinimumFare
    ),
    sameCityRadiusKm: nonNegative(row.sameCityRadiusKm ?? row.same_city_radius_km, defaults.sameCityRadiusKm),
    offsetFloor: nonNegative(row.offsetFloor ?? row.offset_floor, defaults.offsetFloor),
    intraBasePrice: nonNegative(row.intraBasePrice ?? row.intra_base_price, defaults.intraBasePrice),
    intraIncludedKm: nonNegative(row.intraIncludedKm ?? row.intra_included_km, defaults.intraIncludedKm),
    intraExtraKmRate: nonNegative(
      row.intraExtraKmRate ?? row.intra_extra_km_rate,
      defaults.intraExtraKmRate
    ),
    tireDamageSurcharge: nonNegative(
      row.tireDamageSurcharge ?? row.tire_damage_surcharge,
      defaults.tireDamageSurcharge
    ),
    offsets: {
      hydraulic: money(offsets.hydraulic, defaults.offsets.hydraulic),
      normal: money(offsets.normal, defaults.offsets.normal),
      box: money(offsets.box, defaults.offsets.box),
    },
    intraCity: {
      workshop: nonNegative(intra.workshop, defaults.intraCity.workshop),
      general: nonNegative(intra.general, defaults.intraCity.general),
      industrial: nonNegative(intra.industrial, defaults.intraCity.industrial),
      taqdeer: nonNegative(intra.taqdeer, defaults.intraCity.taqdeer),
    },
  };
}

function cityKey(name: string | null | undefined): string {
  const text = String(name || '').trim();
  if (!text) return '';
  const center = cityCenterFromName(text);
  if (center) return `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  return text.toLowerCase();
}

/** Same city when both labels resolve to one city, otherwise when the drive is inside the radius. */
export function isSameCityTrip(input: {
  distanceKm: number;
  pickupCity?: string | null;
  dropoffCity?: string | null;
  radiusKm: number;
}): boolean {
  const pickup = cityKey(input.pickupCity);
  const dropoff = cityKey(input.dropoffCity);
  if (pickup && dropoff) return pickup === dropoff;
  const distance = Number(input.distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return false;
  return distance <= Math.max(0, input.radiusKm);
}

export function normalizeIntraCityService(value: unknown): IntraCityService {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'workshop' || key === 'workshop_to_workshop') return 'workshop';
  if (key === 'industrial' || key === 'industrial_area') return 'industrial';
  if (key === 'taqdeer' || key === 'accident' || key === 'assessment') return 'taqdeer';
  return 'general';
}

export function normalizeFlatbedKind(value: unknown): keyof FlatbedOffsets {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'hydraulic' || key === 'full_down' || key === 'full-down') return 'hydraulic';
  if (key === 'box' || key === 'enclosed' || key === 'closed') return 'box';
  return 'normal';
}

export interface FlatbedQuoteInput {
  tariff?: unknown;
  distanceKm: number;
  pickupCity?: string | null;
  dropoffCity?: string | null;
  truckType?: string | null;
  intraCityService?: string | null;
  /** False adds the damaged-tire surcharge. Omitted means intact. */
  tiresIntact?: boolean | null;
}

export interface FlatbedQuote {
  tripType: 'inside_city' | 'outside_city';
  sameCity: boolean;
  distanceKm: number;
  ratePerKm: number;
  baseFee: number;
  distanceFare: number;
  includedKm: number;
  /** Kilometers billed above includedKm. */
  billableKm: number;
  intraCityService: IntraCityService | null;
  flatbedKind: keyof FlatbedOffsets;
  offset: number;
  fareBeforeTire: number;
  tireSurcharge: number;
  tripFare: number;
}

export function quoteFlatbed(input: FlatbedQuoteInput): FlatbedQuote {
  const tariff = readFlatbedTariff(input.tariff ?? {});
  const distanceKm = Math.max(0, Math.round((Number(input.distanceKm) || 0) * 10) / 10);
  const sameCity = isSameCityTrip({
    distanceKm,
    pickupCity: input.pickupCity,
    dropoffCity: input.dropoffCity,
    radiusKm: tariff.sameCityRadiusKm,
  });
  const kind = normalizeFlatbedKind(input.truckType);
  const offset = tariff.offsets[kind];
  const requestedMode = normalizeIntraCityService(input.intraCityService);
  const usesKmThreshold = requestedMode === 'workshop' || requestedMode === 'industrial';
  let distanceFare = 0;
  let intra: IntraCityService | null = null;
  let includedKm = 0;
  let billableKm = 0;
  let ratePerKm = 0;
  if (usesKmThreshold) {
    intra = requestedMode;
    includedKm = tariff.intraIncludedKm;
    billableKm = Math.max(0, Math.round((distanceKm - includedKm) * 10) / 10);
    ratePerKm = tariff.intraExtraKmRate;
    distanceFare = Math.round((tariff.intraBasePrice + billableKm * ratePerKm) * 100) / 100;
  } else if (sameCity) {
    intra = requestedMode;
    distanceFare = tariff.intraCity[intra];
  } else {
    const metered = tariff.intercityBaseFee + tariff.intercityRatePerKm * distanceKm;
    distanceFare = Math.max(tariff.intercityMinimumFare, Math.round(metered * 100) / 100);
    ratePerKm = tariff.intercityRatePerKm;
    billableKm = distanceKm;
  }
  const shifted = Math.round((distanceFare + offset) * 100) / 100;
  const fareBeforeTire = offset < 0 ? Math.max(tariff.offsetFloor, shifted) : Math.max(0, shifted);
  const tireSurcharge = input.tiresIntact === false ? tariff.tireDamageSurcharge : 0;
  return {
    tripType: sameCity ? 'inside_city' : 'outside_city',
    sameCity,
    distanceKm,
    ratePerKm,
    baseFee: usesKmThreshold ? tariff.intraBasePrice : sameCity ? distanceFare : tariff.intercityBaseFee,
    distanceFare,
    includedKm,
    billableKm,
    intraCityService: intra,
    flatbedKind: kind,
    offset,
    fareBeforeTire,
    tireSurcharge,
    tripFare: Math.round((fareBeforeTire + tireSurcharge) * 100) / 100,
  };
}
