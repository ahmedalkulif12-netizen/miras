/**
 * Server-side service category canonicalization + vehicle↔order matching.
 * Mirrors src/domain/serviceCategories.ts (keep in sync).
 */

const CORE_SERVICE_TYPES = new Set([
  'furniture_moving',
  'flatbed',
  'refrigerated',
  'heavy_equipment',
  'goods_transport',
  'water_tanker',
]);

const SERVICE_ALIASES: Record<string, string> = {
  cold: 'refrigerated',
  cargo: 'goods_transport',
  furniture_transport: 'furniture_moving',
  towing: 'flatbed',
  tow_truck: 'flatbed',
  tanker: 'water_tanker',
  water: 'water_tanker',
  normal: 'flatbed',
  normal_truck: 'flatbed',
  hydraulic: 'flatbed',
  box: 'flatbed',
  small_truck: 'furniture_moving',
  medium_truck: 'furniture_moving',
  large_truck: 'furniture_moving',
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

export function canonicalizeServiceType(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  if (CORE_SERVICE_TYPES.has(key)) return key;
  return SERVICE_ALIASES[key] ?? null;
}

export function resolveOrderRequiredVehicleType(order: {
  requiredVehicleType?: unknown;
  serviceType?: unknown;
  truckType?: unknown;
} | null | undefined): string | null {
  if (!order) return null;
  return (
    canonicalizeServiceType(
      typeof order.requiredVehicleType === 'string' ? order.requiredVehicleType : null
    ) ||
    canonicalizeServiceType(typeof order.serviceType === 'string' ? order.serviceType : null) ||
    canonicalizeServiceType(typeof order.truckType === 'string' ? order.truckType : null)
  );
}

/**
 * Strict category match: driver's registered vehicle must equal the order's
 * required vehicle / service category (aliases normalized). Empty / unknown → no match.
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
    requiredVehicleType?: unknown;
    serviceType?: unknown;
    truckType?: unknown;
  } | null | undefined
): boolean {
  return driverVehicleMatchesOrder(
    driverVehicleType,
    resolveOrderRequiredVehicleType(order)
  );
}
