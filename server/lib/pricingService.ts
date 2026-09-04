import admin from 'firebase-admin';
import { computeTripFare } from '../../src/domain/pricing-engine.ts';
import { buildTripFinancials, toLegacyPricingFields, shouldWaiveServiceFee } from '../../src/domain/financials.ts';
import { countPaidCustomerOrders, remainingFreeServiceFeeOrders } from './customerOrderCount.ts';
import {
  defaultPricingForService,
  mergePricingConfig,
  normalizeServiceType,
  pricingDocCandidates,
} from '../../src/lib/pricingDefaults.ts';
import { canUseAdminFirestore } from './firebaseAdmin.ts';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  sanitizeWaterTankerDistanceKm,
} from '../../src/lib/waterTankerDistance.ts';

const CACHE_TTL = 5 * 60 * 1000;

export type PricingService = ReturnType<typeof createPricingService>;

/**
 * Server-authoritative pricing (single source of truth for trip totals).
 * Formula: tripFare = base + max(0, distanceKm − 25) × tierRate
 * Customer total = tripFare + 5% · Driver net = tripFare − 15%
 */
export function createPricingService(db: admin.firestore.Firestore) {
  let cachedPricing: Record<string, { data: Record<string, unknown>; fetchedAt: number }> = {};

  async function getPricing(serviceType: string) {
    const service = normalizeServiceType(serviceType);
    const now = Date.now();
    if (cachedPricing[service] && now - cachedPricing[service].fetchedAt < CACHE_TTL) {
      return cachedPricing[service].data;
    }

    const defaults = defaultPricingForService(service) as unknown as Record<string, unknown>;

    if (!canUseAdminFirestore()) {
      cachedPricing[service] = { data: defaults, fetchedAt: now };
      return defaults;
    }

    try {
      const snap = await db.collection('pricing').get();
      const byId: Record<string, Record<string, unknown>> = {};
      snap.forEach((row) => {
        byId[row.id] = row.data() as Record<string, unknown>;
      });

      for (const docId of pricingDocCandidates(service)) {
        const data = byId[docId];
        if (data) {
          const merged = mergePricingConfig(service, data) as unknown as Record<string, unknown>;
          cachedPricing[service] = { data: merged, fetchedAt: now };
          return merged;
        }
      }
    } catch (error) {
      console.warn(`[pricing] Firestore unavailable for ${service} — using built-in defaults:`, error);
    }

    cachedPricing[service] = { data: defaults, fetchedAt: now };
    return defaults;
  }

  async function calculatePrice(params: {
    distance: number;
    serviceType: string;
    /** Vehicle / capacity tier (small_truck, hydraulic, 1000L, …). */
    option?: string;
    truckType?: 'normal' | 'hydraulic' | 'box' | string;
    truckCount?: number;
    previousOrdersCount?: number;
    userId?: string;
    /** Water tanker capacity (1000L–12000L) — never treated as distance. */
    capacity?: string;
    /** Water quality / job type: fresh | normal | sewage. */
    waterType?: string;
  }) {
    const {
      distance,
      serviceType,
      option,
      truckType = 'normal',
      truckCount = 1,
      capacity,
      waterType,
      userId,
    } = params;

    let previousOrdersCount = Number(params.previousOrdersCount);
    if (!Number.isFinite(previousOrdersCount) || previousOrdersCount < 0) {
      previousOrdersCount = 0;
    }
    if (userId && canUseAdminFirestore()) {
      try {
        previousOrdersCount = await countPaidCustomerOrders(db, userId);
      } catch (error) {
        console.warn('[pricing] previous-orders lookup skipped:', error);
      }
    }

    const service = normalizeServiceType(serviceType);
    const pricing = await getPricing(service);

    const safeDistance =
      service === 'water_tanker'
        ? sanitizeWaterTankerDistanceKm(distance, WATER_TANKER_MOCK_DISTANCE_KM)
        : distance;

    // For water tankers never fall back to flatbed truckType ("normal").
    const resolvedOption =
      service === 'water_tanker'
        ? option || capacity
        : option || capacity || truckType;

    const fare = computeTripFare(pricing, {
      distance: safeDistance,
      serviceType: service,
      option: resolvedOption,
      truckType,
      truckCount,
      capacity,
      waterType,
    });

    // Canonical subtotal from visible line items.
    const lineSubtotal = Math.round((fare.base + fare.extraKmCost) * 100) / 100;
    // When truckCount/surge inflate tripFare, prefer engine tripFare; otherwise line items.
    const tripFareForTotals =
      fare.surgeApplied || truckCount > 1 ? fare.tripFare : lineSubtotal;

    const isServiceFeeFree = shouldWaiveServiceFee(previousOrdersCount);
    const financials = buildTripFinancials(tripFareForTotals, {
      waiveServiceFee: isServiceFeeFree,
    });

    const pricingSnapshot = {
      ...pricing,
      platform_commission_percentage: 15,
      customer_service_fee_percentage: 5,
      fee_policy_version: financials.feePolicyVersion,
      included_km: fare.includedKm,
      tier: fare.tier,
      ...(fare.capacity ? { capacity: fare.capacity } : {}),
      ...(fare.waterType ? { waterType: fare.waterType } : {}),
      driver_distance_km: safeDistance,
      extra_km: fare.extraKm,
      line_base: fare.base,
      line_extra_km_cost: fare.extraKmCost,
      line_subtotal: lineSubtotal,
      price_per_km: fare.rate,
      base_price: fare.base,
    };

    return {
      ...toLegacyPricingFields(financials, {
        isServiceFeeFree,
        tripType: fare.tripType,
        base: fare.base,
        extraKm: fare.extraKmCost,
        rate: fare.rate,
        surgeApplied: fare.surgeApplied,
        isPriceCapApplied: fare.isPriceCapApplied,
        pricingSnapshot,
      }),
      previousPaidOrderCount: previousOrdersCount,
      remainingFreeOrders: remainingFreeServiceFeeOrders(previousOrdersCount),
      includedKm: fare.includedKm,
      extraDistanceKm: fare.extraKm,
      capacity: fare.capacity,
      waterType: fare.waterType,
      tier: fare.tier,
      option: fare.tier,
      driverDistanceKm: safeDistance,
    };
  }

  return { getPricing, calculatePrice };
}
