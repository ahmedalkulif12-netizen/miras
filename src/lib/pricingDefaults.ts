/**
 * Shared default pricing when Firestore `pricing/{serviceType}` docs are missing.
 * Universal rule: first 25 km included in base; extra km billed at tier rate.
 * Client service fee 5% and driver commission 15% live in domain/financials.ts.
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
    small_truck: { base_price: 60, price_per_km: 1.0 }, // دباب
    medium_truck: { base_price: 350, price_per_km: 1.0 }, // دينا
    large_truck: { base_price: 750, price_per_km: 0.75 }, // تريلا
  },
  // Service 2 — Towing & Flatbeds (السطحات)
  flatbed: {
    normal: { base_price: 110, price_per_km: 0.75 }, // سطحة عادية
    hydraulic: { base_price: 150, price_per_km: 1.0 }, // هيدروليك
    box: { base_price: 200, price_per_km: 1.5 }, // بوكس
  },
  // Service 3 — Water Tankers (صهاريج المياه) — capacity tiers (type multiplier applied separately)
  water_tanker: {
    '1000L': { base_price: 80, price_per_km: 0.75 },
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
    chilled: { base_price: 300, price_per_km: 1.0 }, // تبريد خفيف
    cold_normal: { base_price: 400, price_per_km: 1.5 }, // تبريد عادي
    frozen: { base_price: 550, price_per_km: 2.0 }, // تجميد
  },
  // Service 6 — Cargo & Goods Transport (نقل البضائع)
  goods_transport: {
    van: { base_price: 80, price_per_km: 0.75 }, // فان
    dyna: { base_price: 200, price_per_km: 1.5 }, // دينا
    trailer: { base_price: 750, price_per_km: 2.0 }, // تريلا
    cement_mixer: { base_price: 500, price_per_km: 2.0 }, // خلاطات أسمنت
    brick_transporter: { base_price: 450, price_per_km: 1.75 }, // ناقلات طوب
  },
};

/** Default tier key when the customer has not picked an option yet. */
export const DEFAULT_TIER_BY_SERVICE: Record<string, string> = {
  furniture_moving: 'small_truck',
  flatbed: 'normal',
  water_tanker: '1000L',
  heavy_equipment: 'light_equip',
  refrigerated: 'chilled',
  goods_transport: 'van',
  cold: 'chilled',
  cargo: 'van',
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
  max_price: undefined,
  heavy_multiplier: 1,
  cold_multiplier: 1,
  hydraulic_multiplier: 1,
  max_price_outside: 0,
  minimum_price: 110,
  surge_multiplier: 1.0,
  platform_commission_percentage: 15,
  tier_prices: { ...SERVICE_TIER_PRICES.flatbed },
};

/** Prefer an existing sibling doc when a service-specific pricing row is absent. */
export const PRICING_DOC_FALLBACKS: Record<string, string[]> = {
  furniture_moving: ['furniture_moving', 'default'],
  heavy_equipment: ['heavy_equipment', 'default'],
  refrigerated: ['refrigerated', 'default'],
  water_tanker: ['water_tanker', 'default'],
  goods_transport: ['goods_transport', 'default'],
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
  const allowed = new Set(['1000', '3000', '5000', '7000', '10000', '12000']);
  if (allowed.has(digits)) {
    return `${digits}L`;
  }
  const trimmed = String(raw).trim().toUpperCase();
  if (trimmed in SERVICE_TIER_PRICES.water_tanker) return trimmed;
  // Composite keys like fresh_3000L
  const match = trimmed.match(/(1000|3000|5000|7000|10000|12000)L?$/);
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
      : undefined;

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
    tier_prices: { ...tiers },
    ...(capacityPrices ? { capacity_prices: capacityPrices } : {}),
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
    tier_prices: row.tier_prices || defaults.tier_prices,
    capacity_prices: row.capacity_prices || defaults.capacity_prices,
    heavy_multiplier: 1,
    cold_multiplier: 1,
    hydraulic_multiplier: 1,
  };
}

/** Firestore seed payload for pricing/{serviceType}. */
export function firestorePricingDoc(serviceType: string): Record<string, unknown> {
  const cfg = defaultPricingForService(serviceType);
  return {
    ...cfg,
    fee_policy_version: '2026-08',
    customer_service_fee_percentage: 5,
    included_km: INCLUDED_KM,
    free_km: INCLUDED_KM,
    updatedAt: new Date().toISOString(),
  };
}
