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

export type FlatbedPricingScope = 'intra_city' | 'inter_city';

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
  /** Percent of the intra-city trip fare kept from the driver. */
  intraDriverCommissionPercentage: number;
  /** Percent of the intra-city trip fare charged to the customer. */
  intraCustomerServiceFeePercentage: number;
  /** Percent of the inter-city trip fare kept from the driver. */
  intercityDriverCommissionPercentage: number;
  /** Percent of the inter-city trip fare charged to the customer. */
  intercityCustomerServiceFeePercentage: number;
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
  intraDriverCommissionPercentage: 10,
  intraCustomerServiceFeePercentage: 5,
  intercityDriverCommissionPercentage: 15,
  intercityCustomerServiceFeePercentage: 5,
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

function percent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return Math.round(n * 1000) / 1000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readFlatbedTariff(source: unknown): FlatbedTariff {
  const root = asRecord(source);
  const nested = asRecord(root.flatbed_tariff);
  const row = Object.keys(nested).length > 0 ? nested : root;
  const intraNode = { ...asRecord(nested.intra_city), ...asRecord(root.intra_city) };
  const interNode = { ...asRecord(nested.inter_city), ...asRecord(root.inter_city) };
  const mods = { ...asRecord(nested.flatbed_modifiers), ...asRecord(root.flatbed_modifiers) };
  const offsets = { ...asRecord(row.offsets), ...asRecord(mods.offsets) };
  const intraPrices = asRecord(row.intraCity);
  const defaults = DEFAULT_FLATBED_TARIFF;
  return {
    intercityBaseFee: nonNegative(
      interNode.basePrice ?? interNode.base_price ?? row.intercityBaseFee ?? row.intercity_base_fee,
      defaults.intercityBaseFee
    ),
    intercityRatePerKm: nonNegative(
      interNode.ratePerKm ?? interNode.rate_per_km ?? row.intercityRatePerKm ?? row.intercity_rate_per_km,
      defaults.intercityRatePerKm
    ),
    intercityMinimumFare: nonNegative(
      interNode.minimumFare ?? interNode.minimum_fare ?? row.intercityMinimumFare ?? row.intercity_minimum_fare,
      defaults.intercityMinimumFare
    ),
    sameCityRadiusKm: nonNegative(
      interNode.sameCityRadiusKm ?? interNode.same_city_radius_km ?? mods.sameCityRadiusKm ?? row.sameCityRadiusKm ?? row.same_city_radius_km,
      defaults.sameCityRadiusKm
    ),
    offsetFloor: nonNegative(
      mods.offsetFloor ?? mods.offset_floor ?? row.offsetFloor ?? row.offset_floor,
      defaults.offsetFloor
    ),
    intraBasePrice: nonNegative(
      intraNode.basePrice ?? intraNode.base_price ?? row.intraBasePrice ?? row.intra_base_price,
      defaults.intraBasePrice
    ),
    intraIncludedKm: nonNegative(
      intraNode.includedKm ?? intraNode.included_km ?? row.intraIncludedKm ?? row.intra_included_km,
      defaults.intraIncludedKm
    ),
    intraExtraKmRate: nonNegative(
      intraNode.extraKmRate ?? intraNode.extra_km_rate ?? row.intraExtraKmRate ?? row.intra_extra_km_rate,
      defaults.intraExtraKmRate
    ),
    intraDriverCommissionPercentage: percent(
      intraNode.driverCommissionPercentage ?? intraNode.driver_commission_percentage ?? row.intraDriverCommissionPercentage,
      defaults.intraDriverCommissionPercentage
    ),
    intraCustomerServiceFeePercentage: percent(
      intraNode.customerServiceFeePercentage ?? intraNode.customer_service_fee_percentage ?? row.intraCustomerServiceFeePercentage,
      defaults.intraCustomerServiceFeePercentage
    ),
    intercityDriverCommissionPercentage: percent(
      interNode.driverCommissionPercentage ?? interNode.driver_commission_percentage ?? row.intercityDriverCommissionPercentage,
      defaults.intercityDriverCommissionPercentage
    ),
    intercityCustomerServiceFeePercentage: percent(
      interNode.customerServiceFeePercentage ?? interNode.customer_service_fee_percentage ?? row.intercityCustomerServiceFeePercentage,
      defaults.intercityCustomerServiceFeePercentage
    ),
    tireDamageSurcharge: nonNegative(
      mods.tireDamageSurcharge ?? mods.tire_damage_surcharge ?? row.tireDamageSurcharge ?? row.tire_damage_surcharge,
      defaults.tireDamageSurcharge
    ),
    offsets: {
      hydraulic: money(offsets.hydraulic, defaults.offsets.hydraulic),
      normal: money(offsets.normal, defaults.offsets.normal),
      box: money(offsets.box, defaults.offsets.box),
    },
    intraCity: {
      workshop: nonNegative(intraPrices.workshop, defaults.intraCity.workshop),
      general: nonNegative(intraPrices.general, defaults.intraCity.general),
      industrial: nonNegative(intraPrices.industrial, defaults.intraCity.industrial),
      taqdeer: nonNegative(
        intraNode.taqdeerPrice ?? intraNode.taqdeer_price ?? intraPrices.taqdeer,
        defaults.intraCity.taqdeer
      ),
    },
  };
}

/** Firestore fields on pricing/flatbed. The app reads intra_city or inter_city for the trip. */
export function flatbedConfigNodes(tariff: FlatbedTariff): Record<string, unknown> {
  const next = readFlatbedTariff(tariff);
  return {
    intra_city: {
      basePrice: next.intraBasePrice,
      includedKm: next.intraIncludedKm,
      extraKmRate: next.intraExtraKmRate,
      driverCommissionPercentage: next.intraDriverCommissionPercentage,
      customerServiceFeePercentage: next.intraCustomerServiceFeePercentage,
      taqdeerPrice: next.intraCity.taqdeer,
    },
    inter_city: {
      basePrice: next.intercityBaseFee,
      ratePerKm: next.intercityRatePerKm,
      minimumFare: next.intercityMinimumFare,
      sameCityRadiusKm: next.sameCityRadiusKm,
      driverCommissionPercentage: next.intercityDriverCommissionPercentage,
      customerServiceFeePercentage: next.intercityCustomerServiceFeePercentage,
    },
    flatbed_modifiers: {
      offsets: next.offsets,
      offsetFloor: next.offsetFloor,
      tireDamageSurcharge: next.tireDamageSurcharge,
    },
    flatbed_tariff: next,
  };
}

export function flatbedFeesForScope(tariff: FlatbedTariff, scope: FlatbedPricingScope): {
  driverCommissionPercentage: number;
  customerServiceFeePercentage: number;
} {
  if (scope === 'inter_city') {
    return {
      driverCommissionPercentage: tariff.intercityDriverCommissionPercentage,
      customerServiceFeePercentage: tariff.intercityCustomerServiceFeePercentage,
    };
  }
  return {
    driverCommissionPercentage: tariff.intraDriverCommissionPercentage,
    customerServiceFeePercentage: tariff.intraCustomerServiceFeePercentage,
  };
}

/** Workshop and industrial always use the intra-city node. Other trips follow the stored scope or city. */
export function flatbedPricingScopeFromOrder(order: Record<string, unknown>): FlatbedPricingScope {
  const details = asRecord(order.serviceDetails);
  const mode = String(details.intraCityService || order.intraCityService || '').trim().toLowerCase();
  if (
    mode === 'workshop' ||
    mode === 'workshop_to_workshop' ||
    mode === 'industrial' ||
    mode === 'industrial_area'
  ) {
    return 'intra_city';
  }
  const snapshot = asRecord(order.pricing_snapshot || order.pricingSnapshot);
  const stored = String(snapshot.pricingScope || snapshot.pricing_scope || '');
  if (stored === 'inter_city' || stored === 'intra_city') return stored;
  const tripType = String(order.tripType || snapshot.tripType || '');
  return tripType === 'outside_city' ? 'inter_city' : 'intra_city';
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
  /** Which Firestore node supplied the distance rule and the fee percents. */
  pricingScope: FlatbedPricingScope;
  driverCommissionPercentage: number;
  customerServiceFeePercentage: number;
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
  const pricingScope: FlatbedPricingScope = usesKmThreshold || sameCity ? 'intra_city' : 'inter_city';
  const fees = flatbedFeesForScope(tariff, pricingScope);
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
    pricingScope,
    driverCommissionPercentage: fees.driverCommissionPercentage,
    customerServiceFeePercentage: fees.customerServiceFeePercentage,
  };
}
