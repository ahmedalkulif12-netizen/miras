/**
 * Water tanker (صهاريج المياه) — delivery-only booking model.
 * Customer sets one drop-off point; the pre-filled tanker drives there.
 */

import { canonicalizeServiceType } from '@/domain/serviceCategories';

export function isWaterTankerService(
  serviceType: string | null | undefined
): boolean {
  return canonicalizeServiceType(serviceType) === 'water_tanker';
}

/** True when the order only needs a customer drop-off (no load/unload origin). */
export function isDeliveryOnlyOrder(order: {
  serviceType?: string | null;
  deliveryOnly?: boolean | null;
  locationMode?: string | null;
}): boolean {
  if (order.deliveryOnly === true) return true;
  if (order.locationMode === 'delivery_only') return true;
  return isWaterTankerService(order.serviceType);
}
