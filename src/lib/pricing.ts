import { LogisticsServiceType } from '@/types';
import type { TripFinancials } from '@/domain/financials';
import { buildTripFinancials, toLegacyPricingFields, shouldWaiveServiceFee } from '@/domain/financials';
import { computeTripFare } from '@/domain/pricing-engine';
import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { calculateTotal } from '@/lib/checkoutTotal';
import {
  defaultPricingForService,
  normalizeServiceType,
  normalizeWaterTankerCapacity,
} from '@/lib/pricingDefaults';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  sanitizeWaterTankerDistanceKm,
} from '@/lib/waterTankerDistance';
import { auth } from '@/lib/firebase';
import { countCustomerPaidOrders } from '@/lib/customerOrderCount';

export interface CalculatedPrice {
  /** @deprecated use financials.tripFare */
  subtotal: number;
  /** @deprecated use financials.customerTotal */
  total: number;
  base: number;
  extraKm: number;
  serviceFee: number;
  /** @deprecated use financials.platformFee */
  commission_amount: number;
  /** @deprecated use financials.driverNet */
  driver_earning: number;
  /** Canonical money breakdown (Phase A) */
  financials?: TripFinancials;
  rate: number;
  isServiceFeeFree: boolean;
  surgeApplied: boolean;
  tripType: 'inside_city' | 'outside_city';
  isPriceCapApplied: boolean;
  /** Kilometers included in base price (25 for all services). */
  includedKm?: number;
  /** Billable km beyond included radius. */
  extraDistanceKm?: number;
  /** Water tanker capacity used for base price. */
  capacity?: string;
  /** Resolved vehicle / capacity tier key. */
  tier?: string;
  option?: string;
  /** Distance used for the quote (driver→client for tanker, route for transport). */
  driverDistanceKm?: number;
  pricingSnapshot?: Record<string, unknown> & {
    base_price?: number;
    price_per_km?: number;
    surge_multiplier?: number;
    minimum_price?: number;
    platform_commission_percentage?: number;
    hydraulic_multiplier?: number;
    max_price_outside?: number;
    fee_policy_version?: string;
    included_km?: number;
    capacity?: string;
    tier?: string;
    driver_distance_km?: number;
    extra_km?: number | null;
  };
}

export interface CalculateOrderPriceOptions {
  capacity?: string;
  /** Vehicle / capacity tier (small_truck, hydraulic, light_equip, van, …). */
  option?: string;
  /** Water quality type: fresh | normal | sewage. */
  waterType?: string;
  previousOrdersCount?: number;
  truckType?: 'normal' | 'hydraulic' | 'box' | string;
  truckCount?: number;
  pickupCity?: string;
  dropoffCity?: string;
}

/** Local quote using the same engine as the server (bypass / offline). */
function buildLocalDevPrice(
  distance: number,
  serviceType: LogisticsServiceType,
  options: CalculateOrderPriceOptions = {}
): CalculatedPrice {
  const previousOrdersCount = options.previousOrdersCount ?? 0;
  const service = normalizeServiceType(serviceType);
  const pricing = defaultPricingForService(service);
  const resolvedOption =
    options.option ||
    options.capacity ||
    options.truckType ||
    undefined;
  const fare = computeTripFare(pricing, {
    distance,
    serviceType: service,
    option: resolvedOption,
    truckType: options.truckType || 'normal',
    truckCount: options.truckCount ?? 1,
    capacity: options.capacity,
    waterType: options.waterType,
  });
  const lineSubtotal = Math.round((fare.base + fare.extraKmCost) * 100) / 100;
  const truckCount = options.truckCount ?? 1;
  const tripFare =
    fare.surgeApplied || truckCount > 1 ? fare.tripFare : lineSubtotal;
  const isServiceFeeFree = shouldWaiveServiceFee(previousOrdersCount);
  const financials = buildTripFinancials(tripFare, { waiveServiceFee: isServiceFeeFree });
  const checkout = calculateTotal({
    basePrice: fare.base,
    extraDistanceFee: fare.extraKmCost,
    serviceFee: financials.serviceFee,
  });
  return {
    ...toLegacyPricingFields(
      {
        ...financials,
        tripFare: checkout.basePrice + checkout.extraDistanceFee,
        serviceFee: checkout.serviceFee,
        customerTotal: checkout.total,
      },
      {
        isServiceFeeFree,
        tripType: fare.tripType,
        base: checkout.basePrice,
        extraKm: checkout.extraDistanceFee,
        rate: fare.rate,
        surgeApplied: fare.surgeApplied,
        isPriceCapApplied: fare.isPriceCapApplied,
        pricingSnapshot: {
          base_price: checkout.basePrice,
          price_per_km: fare.rate,
          surge_multiplier: pricing.surge_multiplier,
          minimum_price: pricing.minimum_price,
          platform_commission_percentage: pricing.platform_commission_percentage,
          included_km: fare.includedKm,
          capacity: fare.capacity,
          tier: fare.tier,
          driver_distance_km: distance,
          extra_km: fare.extraKm,
          line_subtotal: checkout.basePrice + checkout.extraDistanceFee,
        },
      }
    ),
    includedKm: fare.includedKm,
    extraDistanceKm: fare.extraKm,
    capacity: fare.capacity,
    tier: fare.tier,
    option: fare.tier,
    driverDistanceKm: distance,
  };
}

/**
 * @param distance Kilometers (driver→client for water_tanker, route km for transport).
 *                 Never pass tank liters or tons here.
 */
export const calculateOrderPrice = async (
  distance: number,
  serviceType: LogisticsServiceType,
  pickupCity: string,
  dropoffCity: string,
  truckType: 'normal' | 'hydraulic' | 'box' | string = 'normal',
  truckCount: number = 1,
  previousOrdersCount: number = 0,
  capacity?: string,
  option?: string,
  waterType?: string
): Promise<CalculatedPrice> => {
  const service = normalizeServiceType(serviceType) as LogisticsServiceType;
  const normalizedCapacity =
    service === 'water_tanker' ? normalizeWaterTankerCapacity(capacity || option) : undefined;
  const resolvedOption = option || normalizedCapacity || truckType;

  let paidCount = previousOrdersCount;
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      paidCount = await countCustomerPaidOrders(uid);
    }
  } catch {
    /* keep caller-supplied count */
  }

  // Never allow tank liters (1000/3000/5000) to travel as "distance".
  const safeDistanceKm =
    service === 'water_tanker'
      ? sanitizeWaterTankerDistanceKm(distance, WATER_TANKER_MOCK_DISTANCE_KM)
      : distance;

  try {
    const response = await authFetch('/api/calculate-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distance: safeDistanceKm,
        serviceType: service,
        pickupCity,
        dropoffCity,
        truckType,
        truckCount,
        previousOrdersCount: paidCount,
        option: resolvedOption,
        ...(normalizedCapacity ? { capacity: normalizedCapacity } : {}),
        ...(service === 'water_tanker' && waterType ? { waterType } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, 'Failed to calculate price on server'));
    }
    return readApiJson<CalculatedPrice>(response);
  } catch (error) {
    console.warn('[pricing] Server quote unavailable — using built-in rates:', error);
    return buildLocalDevPrice(safeDistanceKm, service, {
      capacity: normalizedCapacity,
      option: resolvedOption,
      waterType,
      previousOrdersCount: paidCount,
      truckType,
      truckCount,
      pickupCity,
      dropoffCity,
    });
  }
};
