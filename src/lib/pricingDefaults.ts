import {
  DEFAULT_DRIVER_COMMISSION_TIERS,
  type DriverCommissionTier,
  normalizeDriverCommissionTiers,
  resolveCustomerServiceFeePercentage,
} from '@/domain/financials';

/**
 * Shared default pricing when Firestore `pricing/{serviceType}` docs are missing.
 * Universal rule: first 25 km included in base; extra km billed at tier rate.
 * Customer service fee and driver commission default to 5% and 15%.
 * Checkout reads those percentages from Firestore `pricing/{service}`; driver
 * loyalty bands live on `driver_commission_tiers` (see domain/financials.ts).
 */

export interface TierRate {
  base_price: number;
  price_per_km: number;
}

export interface PricingConfig {
  base_price: number;
  price_per_km: number;
  free_km?: number;
  max_price?: number;
  min_price?: number;
  /** @deprecated Tier rates replace multipliers — kept for Firestore backward compat. */
  heavy_multiplier: number;
  /** @deprecated Tier rates replace multipliers — kept for Firestore backward compat. */
  cold_multiplier: number;
  /** @deprecated Tier rates replace multipliers — kept for Firestore backward compat. */
  hydraulic_multiplier: number;
  max_price_outside: number;
  minimum_price: number;
  surge_multiplier: number;
  platform_commission_percentage: number;
  /** Customer checkout fee, percent of trip fare. Firestore may override 5. */
  customer_service_fee_percentage?: number;
  /** Flat delivery fee added to gas-cylinder fares. Other services leave this at 0. */
  delivery_fee?: number;
  /**
   * Driver commission by completed-order count.
   * When missing, the 0-order band uses platform_commission_percentage.
   */
  driver_commission_tiers?: DriverCommissionTier[];
  /** Kilometers included in base price (all services: 25). */
  included_km?: number;
  /** Per-vehicle / capacity tier rates: base up to included_km + SAR/km after. */
  tier_prices?: Record<string, TierRate>;
  /** @deprecated Prefer tier_prices; kept for water-tanker Firestore docs. */
  capacity_prices?: Record<string, number>;
}

/** First N km included in every service base price. */
export const INCLUDED_KM = 25;

/** @deprecated Use INCLUDED_KM — alias for older water-tanker call sites. */
export const WATER_TANKER_INCLUDED_KM = INCLUDED_KM;

/**
 * Exact service-tier matrix (Base ≤ 25 km + Extra SAR/km).
 * Keys match SERVICE_OPTIONS / CustomerDashboard serviceOption values.
 */
export const SERVICE_TIER_PRICES: Record<string, Record<string, TierRate>> = {
  // Service 1 — Moving (نقل العفش)
  furniture_moving: {
    small_van: { base_price: 80, price_per_km: 1.0 },
    hilux: { base_price: 110, price_per_km: 1.0 },
    closed_van: { base_price: 140, price_per_km: 1.2 },
    open_dyna: { base_price: 200, price_per_km: 1.5 },
    box_dyna: { base_price: 350, price_per_km: 1.0 },
    large_truck: { base_price: 750, price_per_km: 2.0 },
    // Legacy keys stay priced so older registrations still quote.
    small_truck: { base_price: 80, price_per_km: 1.0 },
    medium_truck: { base_price: 350, price_per_km: 1.0 },
  },
  // Service 2 — Towing & Flatbeds (السطحات)
  flatbed: {
    normal: { base_price: 110, price_per_km: 0.75 }, // سطحة عادي
    hydraulic: { base_price: 150, price_per_km: 1.0 }, // سطحة هيدروليك
    box: { base_price: 200, price_per_km: 1.5 }, // سطحة بوكس
  },
  // Service 3 — Water. Household fresh tanks are a fixed fare (per-km 0).
  water_tanker: {
    '300L': { base_price: 25, price_per_km: 0 },
    '500L': { base_price: 35, price_per_km: 0 },
    '1000L': { base_price: 80, price_per_km: 0 },
    '3000L': { base_price: 120, price_per_km: 1.2 },
    '5000L': { base_price: 200, price_per_km: 2.0 },
    '7000L': { base_price: 260, price_per_km: 2.5 },
    '10000L': { base_price: 350, price_per_km: 3.2 },
    '12000L': { base_price: 420, price_per_km: 3.8 },
  },
  // Service 4 — Heavy & Equipment Transport (المعدات الثقيلة)
  heavy_equipment: {
    light_equip: { base_price: 300, price_per_km: 1.5 },
    medium_equip: { base_price: 450, price_per_km: 2.0 },
    heavy_equip: { base_price: 750, price_per_km: 3.5 },
  },
  // Service 5 — Refrigerated Transport (النقل المبرد)
  refrigerated: {
    refrigerated_van: { base_price: 400, price_per_km: 1.5 },
    chilled: { base_price: 300, price_per_km: 1.0 }, // تبريد خفيف
    cold_normal: { base_price: 400, price_per_km: 1.5 }, // تبريد عادي
    frozen: { base_price: 550, price_per_km: 2.0 }, // تجميد
  },
  // Service 6 — Cargo & Goods Transport (نقل البضائع)
  goods_transport: {
    small_van: { base_price: 80, price_per_km: 1.0 },
    hilux: { base_price: 110, price_per_km: 1.0 },
    closed_van: { base_price: 140, price_per_km: 1.2 },
    open_dyna: { base_price: 200, price_per_km: 1.5 },
    box_dyna: { base_price: 280, price_per_km: 1.5 },
    trailer: { base_price: 750, price_per_km: 2.0 },
    van: { base_price: 80, price_per_km: 1.0 },
    dyna: { base_price: 200, price_per_km: 1.5 },
  },
  // Home gas cylinders. Base is the cylinder fare; delivery_fee is added on top.
  gas_delivery: {
    cylinder_swap: { base_price: 20, price_per_km: 0 },
    new_cylinder: { base_price: 80, price_per_km: 0 },
  },
};

/** Flat home-delivery fee for gas cylinders. Admin can change it on /admin/pricing. */
export const GAS_DELIVERY_FEE = 15;

/** Default tier key when the customer has not picked an option yet. */
export const DEFAULT_TIER_BY_SERVICE: Record<string, string> = {
  furniture_moving: 'small_van',
  flatbed: 'normal',
  water_tanker: '1000L',
  heavy_equipment: 'light_equip',
  refrigerated: 'refrigerated_van',
  goods_transport: 'small_van',
  gas_delivery: 'cylinder_swap',
  cold: 'chilled',
  cargo: 'small_van',
};

/** Older booking keys that still quote as the closest current vehicle. */
const LEGACY_TIER_ALIASES: Record<string, string> = {
  van: 'small_van',
  small_truck: 'small_van',
  dyna: 'open_dyna',
  medium_truck: 'open_dyna',
};

/** Capacity → base only (legacy helpers). Prefer resolveTierRate. */
export const WATER_TANKER_CAPACITY_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(SERVICE_TIER_PRICES.water_tanker).map(([k, v]) => [k, v.base_price])
);

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  base_price: 110,
  price_per_km: 0.75,
  free_km: INCLUDED_KM,
  included_km: INCLUDED_KM,
  heavy_multiplier: 1,
  cold_multiplier: 1,
  hydraulic_multiplier: 1,
  max_price_outside: 0,
  minimum_price: 110,
  surge_multiplier: 1.0,
  platform_commission_percentage: 15,
  customer_service_fee_percentage: 5,
  driver_commission_tiers: DEFAULT_DRIVER_COMMISSION_TIERS.map((tier) => ({ ...tier })),
  tier_prices: { ...SERVICE_TIER_PRICES.flatbed },
  capacity_prices: {},
};

/** Prefer an existing sibling doc when a service-specific pricing row is absent. */
export const PRICING_DOC_FALLBACKS: Record<string, string[]> = {
  furniture_moving: ['furniture_moving', 'default'],
  heavy_equipment: ['heavy_equipment', 'default'],
  refrigerated: ['refrigerated', 'default'],
  water_tanker: ['water_tanker', 'default'],
  goods_transport: ['goods_transport', 'default'],
  gas_delivery: ['gas_delivery', 'default'],
  flatbed: ['flatbed', 'default'],
};

/** Docs created by server seed / scripts/seed-pricing-tiers.ts */
export const PRICING_SEED_SERVICES = [
  'furniture_moving',
  'flatbed',
  'water_tanker',
  'heavy_equipment',
  'refrigerated',
  'goods_transport',
  'gas_delivery',
  'default',
] as const;

export function pricingDocCandidates(serviceType: string): string[] {
  const mapped = PRICING_DOC_FALLBACKS[serviceType];
  if (mapped) return mapped;
  return [serviceType, 'default'];
}

/** Normalize capacity labels like "1000", "1000L", "1000l" → "1000L". */
export function normalizeWaterTankerCapacity(raw: string | null | undefined): string {
  if (!raw) return '1000L';
  const digits = String(raw).replace(/\D/g, '');
  const allowed = new Set(['300', '500', '1000', '3000', '5000', '7000', '10000', '12000']);
  if (allowed.has(digits)) {
    return `${digits}L`;
  }
  const trimmed = String(raw).trim().toUpperCase();
  if (trimmed in SERVICE_TIER_PRICES.water_tanker) return trimmed;
  // Composite keys like fresh_3000L
  const match = trimmed.match(/(12000|10000|7000|5000|3000|1000|500|300)L?$/);
  if (match) return `${match[1]}L`;
  return '1000L';
}

export function waterTankerCapacityPrice(capacity: string | null | undefined): number {
  const key = normalizeWaterTankerCapacity(capacity);
  return (
    SERVICE_TIER_PRICES.water_tanker[key]?.base_price ??
    SERVICE_TIER_PRICES.water_tanker['1000L'].base_price
  );
}

/** Map aliases (cold/cargo) onto the 6 canonical service IDs. */
export function normalizeServiceType(serviceType: string): string {
  if (serviceType === 'cold') return 'refrigerated';
  if (serviceType === 'cargo') return 'goods_transport';
  if (serviceType === 'furniture_transport') return 'furniture_moving';
  if (serviceType === 'towing') return 'flatbed';
  if (serviceType === 'tanker' || serviceType === 'water') return 'water_tanker';
  if (serviceType === 'gas' || serviceType === 'gas_cylinder') return 'gas_delivery';
  return serviceType;
}

/**
 * Resolve which tier key to use for a quote.
 * Accepts serviceOption, capacity (tankers), or flatbed truckType.
 */
export function resolveTierKey(
  serviceType: string,
  option?: string | null,
  fallbacks: { capacity?: string | null; truckType?: string | null } = {}
): string {
  const service = normalizeServiceType(serviceType);
  const tiers = SERVICE_TIER_PRICES[service] || {};

  if (service === 'water_tanker') {
    const cap = normalizeWaterTankerCapacity(option || fallbacks.capacity);
    if (cap in tiers) return cap;
  }

  const raw = (option || fallbacks.truckType || '').trim();
  if (raw && raw in tiers) return raw;
  const aliased = LEGACY_TIER_ALIASES[raw];
  if (aliased && aliased in tiers) return aliased;

  // Flatbed: box is a distinct tier; hydraulic/normal map directly.
  if (service === 'flatbed' && fallbacks.truckType) {
    const tt = fallbacks.truckType;
    if (tt in tiers) return tt;
  }

  return DEFAULT_TIER_BY_SERVICE[service] || Object.keys(tiers)[0] || 'default';
}

export function resolveTierRate(
  serviceType: string,
  tierKey: string,
  pricing?: Partial<
    Pick<PricingConfig, 'tier_prices' | 'capacity_prices' | 'base_price' | 'price_per_km'>
  >
): TierRate & { tier: string } {
  const service = normalizeServiceType(serviceType);
  const defaults = SERVICE_TIER_PRICES[service] || {};
  const fromConfig = pricing?.tier_prices?.[tierKey];
  if (fromConfig && typeof fromConfig.base_price === 'number') {
    return {
      tier: tierKey,
      base_price: Number(fromConfig.base_price),
      price_per_km: Number(fromConfig.price_per_km) || 0,
    };
  }

  // Legacy water docs: capacity_prices map base only; use default per-km for that tier.
  if (
    service === 'water_tanker' &&
    pricing?.capacity_prices &&
    typeof pricing.capacity_prices[tierKey] === 'number'
  ) {
    const fallbackKm =
      defaults[tierKey]?.price_per_km ??
      (typeof pricing.price_per_km === 'number' ? pricing.price_per_km : 0.75);
    return {
      tier: tierKey,
      base_price: Number(pricing.capacity_prices[tierKey]),
      price_per_km: fallbackKm,
    };
  }

  const builtIn = defaults[tierKey] || defaults[DEFAULT_TIER_BY_SERVICE[service]];
  if (builtIn) {
    return { tier: tierKey in defaults ? tierKey : DEFAULT_TIER_BY_SERVICE[service], ...builtIn };
  }

  return {
    tier: tierKey,
    base_price: Number(pricing?.base_price) || 0,
    price_per_km: Number(pricing?.price_per_km) || 0,
  };
}

function configFromTiers(serviceType: string): PricingConfig {
  const service = normalizeServiceType(serviceType);
  const tiers = SERVICE_TIER_PRICES[service] || SERVICE_TIER_PRICES.flatbed;
  const defaultKey = DEFAULT_TIER_BY_SERVICE[service] || Object.keys(tiers)[0];
  const defaultTier = tiers[defaultKey];
  const capacityPrices =
    service === 'water_tanker'
      ? Object.fromEntries(
          Object.entries(tiers).map(([k, v]) => [k, v.base_price])
        )
      : {};

  return {
    base_price: defaultTier.base_price,
    price_per_km: defaultTier.price_per_km,
    free_km: INCLUDED_KM,
    included_km: INCLUDED_KM,
    heavy_multiplier: 1,
    cold_multiplier: 1,
    hydraulic_multiplier: 1,
    max_price_outside: 0,
    minimum_price: defaultTier.base_price,
    surge_multiplier: 1.0,
    platform_commission_percentage: 15,
    customer_service_fee_percentage: 5,
    driver_commission_tiers: DEFAULT_DRIVER_COMMISSION_TIERS.map((tier) => ({ ...tier })),
    tier_prices: { ...tiers },
    capacity_prices: capacityPrices,
    delivery_fee: service === 'gas_delivery' ? GAS_DELIVERY_FEE : 0,
  };
}

/** Light per-service defaults when only hardcoded rates are available. */
export function defaultPricingForService(serviceType: string): PricingConfig {
  const service = normalizeServiceType(serviceType);
  if (SERVICE_TIER_PRICES[service]) {
    return configFromTiers(service);
  }
  return { ...DEFAULT_PRICING_CONFIG, tier_prices: { ...SERVICE_TIER_PRICES.flatbed } };
}

/** Merge a Firestore pricing row onto built-in rates so missing fields never blank the quote. */
export function mergePricingConfig(
  serviceType: string,
  data?: Partial<PricingConfig> | Record<string, unknown> | null
): PricingConfig {
  const defaults = defaultPricingForService(serviceType);
  if (!data || typeof data !== 'object') return defaults;
  const row = data as Partial<PricingConfig>;
  const included =
    typeof row.included_km === 'number' && row.included_km > 0
      ? row.included_km
      : defaults.included_km || INCLUDED_KM;
  return {
    ...defaults,
    ...row,
    included_km: included,
    free_km: INCLUDED_KM,
    tier_prices: {
      ...(defaults.tier_prices || {}),
      ...(row.tier_prices || {}),
    },
    capacity_prices: {
      ...(defaults.capacity_prices || {}),
      ...(row.capacity_prices || {}),
    },
    customer_service_fee_percentage: resolveCustomerServiceFeePercentage({
      customer_service_fee_percentage:
        row.customer_service_fee_percentage ?? defaults.customer_service_fee_percentage,
    }),
    driver_commission_tiers: Array.isArray(row.driver_commission_tiers)
      ? normalizeDriverCommissionTiers(row.driver_commission_tiers)
      : normalizeDriverCommissionTiers(
          null,
          typeof row.platform_commission_percentage === 'number'
            ? row.platform_commission_percentage
            : defaults.platform_commission_percentage
        ),
    heavy_multiplier: 1,
    cold_multiplier: 1,
    hydraulic_multiplier: 1,
    delivery_fee:
      typeof row.delivery_fee === 'number' && Number.isFinite(row.delivery_fee)
        ? row.delivery_fee
        : defaults.delivery_fee ?? 0,
  };
}

/** Firestore seed payload for pricing/{serviceType}. */
export function firestorePricingDoc(serviceType: string): Record<string, unknown> {
  const cfg = defaultPricingForService(serviceType);
  return {
    ...cfg,
    fee_policy_version: '2026-10',
    customer_service_fee_percentage: cfg.customer_service_fee_percentage ?? 5,
    driver_commission_tiers: cfg.driver_commission_tiers || [],
    included_km: INCLUDED_KM,
    free_km: INCLUDED_KM,
    capacity_prices: cfg.capacity_prices || {},
    tier_prices: cfg.tier_prices || {},
    updatedAt: new Date().toISOString(),
  };
}
