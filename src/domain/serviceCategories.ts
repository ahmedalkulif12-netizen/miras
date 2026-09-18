/**
 * Canonical B2C service categories (6) + strict vehicle↔order matching.
 *
 * 1. furniture_moving  — نقل عفش
 * 2. flatbed           — سطحة
 * 3. refrigerated      — نقل مبرد
 * 4. heavy_equipment   — نقل ثقيل
 * 5. goods_transport   — نقل بضائع
 * 6. water_tanker      — صهاريج
 */

export const CORE_SERVICE_TYPES = [
  'furniture_moving',
  'flatbed',
  'refrigerated',
  'heavy_equipment',
  'goods_transport',
  'water_tanker',
] as const;

export type CoreServiceType = (typeof CORE_SERVICE_TYPES)[number];

/** Legacy aliases that may appear on older profiles / orders. */
const SERVICE_ALIASES: Record<string, CoreServiceType> = {
  cold: 'refrigerated',
  cargo: 'goods_transport',
  furniture_transport: 'furniture_moving',
  moving: 'furniture_moving',
  towing: 'flatbed',
  tow_truck: 'flatbed',
  tow: 'flatbed',
  tanker: 'water_tanker',
  water: 'water_tanker',
  // Arabic labels stored as serviceType on older orders
  'نقل العفش': 'furniture_moving',
  'نقل عفش': 'furniture_moving',
  السطحات: 'flatbed',
  'نقل سطحه': 'flatbed',
  'النقل المبرد': 'refrigerated',
  'نقل مبرد': 'refrigerated',
  'المعدات الثقيلة': 'heavy_equipment',
  'نقل البضائع': 'goods_transport',
  'صهاريج المياه': 'water_tanker',
  'صهاريج': 'water_tanker',
  // Flatbed subtypes / informal vehicle labels
  normal: 'flatbed',
  normal_truck: 'flatbed',
  hydraulic: 'flatbed',
  box: 'flatbed',
  // Furniture truck sizes sometimes stored as vehicleType
  small_truck: 'furniture_moving',
  medium_truck: 'furniture_moving',
  large_truck: 'furniture_moving',
  // Goods / refrigerated / heavy subtypes
  van: 'goods_transport',
  dyna: 'goods_transport',
  trailer: 'goods_transport',
  cement_mixer: 'goods_transport',
  brick_transporter: 'goods_transport',
  chilled: 'refrigerated',
  frozen: 'refrigerated',
  cold_normal: 'refrigerated',
  light_equip: 'heavy_equipment',
  medium_equip: 'heavy_equipment',
  heavy_equip: 'heavy_equipment',
  '1000l': 'water_tanker',
  '3000l': 'water_tanker',
  '5000l': 'water_tanker',
  '7000l': 'water_tanker',
  '10000l': 'water_tanker',
  '12000l': 'water_tanker',
};

/**
 * Normalize any service / vehicle type string to one of the 6 canonical IDs.
 * Returns null when the value is unknown or empty.
 */
export function canonicalizeServiceType(
  raw: string | null | undefined
): CoreServiceType | null {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  if ((CORE_SERVICE_TYPES as readonly string[]).includes(key)) {
    return key as CoreServiceType;
  }
  return SERVICE_ALIASES[key] ?? null;
}

/** Values to query Firestore with so legacy alias docs still match. */
export function serviceTypeQueryValues(
  vehicleOrServiceType: string | null | undefined
): string[] {
  const canonical = canonicalizeServiceType(vehicleOrServiceType);
  if (!canonical) return [];
  if (canonical === 'refrigerated') return ['refrigerated', 'cold'];
  if (canonical === 'goods_transport') return ['goods_transport', 'cargo'];
  if (canonical === 'furniture_moving') {
    return ['furniture_moving', 'furniture_transport'];
  }
  return [canonical];
}

/**
 * Canonical vehicle category the order requires.
 * Prefers `requiredVehicleType`, then `serviceType` — never a flatbed subtype
 * like `normal` when a real service category is present.
 */
export function resolveOrderRequiredVehicleType(order: {
  requiredVehicleType?: string | null;
  serviceType?: string | null;
  truckType?: string | null;
} | null | undefined): CoreServiceType | null {
  if (!order) return null;
  return (
    canonicalizeServiceType(order.requiredVehicleType) ||
    canonicalizeServiceType(order.serviceType) ||
    canonicalizeServiceType(order.truckType)
  );
}

/**
 * Strict category match: driver's registered vehicle type must equal the
 * order's required vehicle / service category (aliases normalized).
 * Empty / unknown → no match.
 */
export function driverVehicleMatchesOrder(
  driverVehicleType: string | null | undefined,
  orderServiceType: string | null | undefined
): boolean {
  const driver = canonicalizeServiceType(driverVehicleType);
  const order = canonicalizeServiceType(orderServiceType);
  if (!driver || !order) return false;
  return driver === order;
}

export function driverMatchesRequiredVehicle(
  driverVehicleType: string | null | undefined,
  order: {
    requiredVehicleType?: string | null;
    serviceType?: string | null;
    truckType?: string | null;
  } | null | undefined
): boolean {
  return driverVehicleMatchesOrder(
    driverVehicleType,
    resolveOrderRequiredVehicleType(order)
  );
}

export function isCoreServiceType(value: string | null | undefined): boolean {
  return canonicalizeServiceType(value) !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

const SERVICE_NAME_ALIASES: Record<string, CoreServiceType> = {
  cold: 'refrigerated',
  cargo: 'goods_transport',
  furniture_transport: 'furniture_moving',
  moving: 'furniture_moving',
  towing: 'flatbed',
  tow_truck: 'flatbed',
  tow: 'flatbed',
  tanker: 'water_tanker',
  water: 'water_tanker',
};

const VEHICLE_OPTION_KEYS = new Set([
  'normal',
  'normal_truck',
  'hydraulic',
  'box',
  'small_truck',
  'medium_truck',
  'large_truck',
  'van',
  'dyna',
  'trailer',
  'cement_mixer',
  'brick_transporter',
  'chilled',
  'frozen',
  'cold_normal',
  'light_equip',
  'medium_equip',
  'heavy_equip',
]);

function mapServiceName(raw: unknown): CoreServiceType | null {
  const key = String(raw || '').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  if ((CORE_SERVICE_TYPES as readonly string[]).includes(lower)) {
    return lower as CoreServiceType;
  }
  if (SERVICE_NAME_ALIASES[lower]) return SERVICE_NAME_ALIASES[lower];
  if (VEHICLE_OPTION_KEYS.has(lower)) return null;
  return canonicalizeServiceType(key);
}

/**
 * Resolve an order's platform service. Prefers canonical serviceType /
 * requiredVehicleType so vehicle options like `small_truck` or `normal`
 * never collapse every trip into Moving.
 */
export function resolveStoredOrderServiceType(
  data: Record<string, unknown> | null | undefined
): CoreServiceType | null {
  if (!data) return null;
  const details = asRecord(data.serviceDetails);
  const named = [
    data.serviceType,
    data.requiredVehicleType,
    data.category,
    details?.serviceType,
    details?.requiredVehicleType,
    details?.category,
  ];
  for (const raw of named) {
    const mapped = mapServiceName(raw);
    if (mapped) return mapped;
  }

  for (const raw of [
    details?.type,
    details?.option,
    details?.vehicleType,
    data.vehicleType,
    data.truckType,
  ]) {
    const canonical = canonicalizeServiceType(String(raw || ''));
    if (canonical) return canonical;
  }
  return null;
}

export interface ServiceDistributionRow {
  serviceType: CoreServiceType;
  count: number;
  percentage: number;
}

/** Counts all six platform services from a full order set (not a 40-row feed). */
export function aggregateServiceDistribution(
  orders: Array<Record<string, unknown> | null | undefined>
): ServiceDistributionRow[] {
  const counts = Object.fromEntries(CORE_SERVICE_TYPES.map((key) => [key, 0])) as Record<
    CoreServiceType,
    number
  >;
  let classified = 0;
  for (const order of orders) {
    if (!order) continue;
    if (String(order.kind || '') === 'driver_registration') continue;
    const serviceType = resolveStoredOrderServiceType(order);
    if (!serviceType) continue;
    counts[serviceType] += 1;
    classified += 1;
  }
  const total = classified > 0 ? classified : 1;
  return CORE_SERVICE_TYPES.map((serviceType) => ({
    serviceType,
    count: counts[serviceType],
    percentage: classified > 0 ? Math.round((counts[serviceType] / total) * 100) : 0,
  })).sort((a, b) => b.count - a.count || a.serviceType.localeCompare(b.serviceType));
}
