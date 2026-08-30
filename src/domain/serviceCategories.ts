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
  towing: 'flatbed',
  tow_truck: 'flatbed',
  tanker: 'water_tanker',
  water: 'water_tanker',
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
