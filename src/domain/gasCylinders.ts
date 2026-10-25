/**
 * Home gas cylinders: exchange count and new-cylinder count are priced
 * separately, then one delivery fee is added. That merchandise total is the
 * trip fare the customer fee and driver commission are calculated from.
 */

export const GAS_CYLINDER_MAX_QUANTITY = 20;

export interface GasCylinderLines {
  exchangeQuantity: number;
  newCylinderQuantity: number;
  exchangeUnitPrice: number;
  newCylinderUnitPrice: number;
  exchangeLineTotal: number;
  newCylinderLineTotal: number;
  deliveryFee: number;
  /** Exchange line + new-cylinder line, before the delivery fee. */
  cylinderSubtotal: number;
  /** cylinderSubtotal + one delivery fee. This is the trip fare. */
  tripFare: number;
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Whole cylinders only. Values outside 0..max clamp into range. */
export function normalizeGasQuantity(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(GAS_CYLINDER_MAX_QUANTITY, n);
}

export function gasQuantityRequested(
  details: Record<string, unknown> | null | undefined
): boolean {
  if (!details) return false;
  return 'exchangeQuantity' in details || 'newCylinderQuantity' in details;
}

export function quoteGasCylinders(input: {
  exchangeUnitPrice: number;
  newCylinderUnitPrice: number;
  deliveryFee: number;
  exchangeQuantity: unknown;
  newCylinderQuantity: unknown;
}): GasCylinderLines {
  const exchangeQuantity = normalizeGasQuantity(input.exchangeQuantity);
  const newCylinderQuantity = normalizeGasQuantity(input.newCylinderQuantity);
  const exchangeUnitPrice = money(Math.max(0, Number(input.exchangeUnitPrice) || 0));
  const newCylinderUnitPrice = money(Math.max(0, Number(input.newCylinderUnitPrice) || 0));
  const exchangeLineTotal = money(exchangeQuantity * exchangeUnitPrice);
  const newCylinderLineTotal = money(newCylinderQuantity * newCylinderUnitPrice);
  const cylinderSubtotal = money(exchangeLineTotal + newCylinderLineTotal);
  const cylinders = exchangeQuantity + newCylinderQuantity;
  const deliveryFee = cylinders > 0 ? money(Math.max(0, Number(input.deliveryFee) || 0)) : 0;
  return {
    exchangeQuantity,
    newCylinderQuantity,
    exchangeUnitPrice,
    newCylinderUnitPrice,
    exchangeLineTotal,
    newCylinderLineTotal,
    deliveryFee,
    cylinderSubtotal,
    tripFare: money(cylinderSubtotal + deliveryFee),
  };
}

export function readGasCylinderLines(source: unknown): GasCylinderLines | null {
  if (!source || typeof source !== 'object') return null;
  const row = source as Record<string, unknown>;
  if (!gasQuantityRequested(row)) return null;
  const exchangeQuantity = normalizeGasQuantity(row.exchangeQuantity);
  const newCylinderQuantity = normalizeGasQuantity(row.newCylinderQuantity);
  if (exchangeQuantity + newCylinderQuantity < 1) return null;
  const exchangeUnitPrice = money(Number(row.exchangeUnitPrice) || 0);
  const newCylinderUnitPrice = money(Number(row.newCylinderUnitPrice) || 0);
  const exchangeLineTotal = money(
    row.exchangeLineTotal != null
      ? Number(row.exchangeLineTotal)
      : exchangeQuantity * exchangeUnitPrice
  );
  const newCylinderLineTotal = money(
    row.newCylinderLineTotal != null
      ? Number(row.newCylinderLineTotal)
      : newCylinderQuantity * newCylinderUnitPrice
  );
  const deliveryFee = money(Number(row.deliveryFee) || 0);
  const cylinderSubtotal = money(exchangeLineTotal + newCylinderLineTotal);
  return {
    exchangeQuantity,
    newCylinderQuantity,
    exchangeUnitPrice,
    newCylinderUnitPrice,
    exchangeLineTotal,
    newCylinderLineTotal,
    deliveryFee,
    cylinderSubtotal,
    tripFare: money(cylinderSubtotal + deliveryFee),
  };
}

/** Persist priced lines. A mixed order omits `type` so any gas driver can take it. */
export function applyGasLinesToServiceDetails(
  details: Record<string, unknown> | undefined,
  lines: GasCylinderLines
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(details || {}) };
  const mixed = lines.exchangeQuantity > 0 && lines.newCylinderQuantity > 0;
  if (mixed) {
    delete next.type;
    delete next.option;
    delete next.serviceOption;
  } else if (lines.exchangeQuantity > 0) {
    next.type = 'cylinder_swap';
  } else if (lines.newCylinderQuantity > 0) {
    next.type = 'new_cylinder';
  }
  next.exchangeQuantity = lines.exchangeQuantity;
  next.newCylinderQuantity = lines.newCylinderQuantity;
  next.exchangeUnitPrice = lines.exchangeUnitPrice;
  next.newCylinderUnitPrice = lines.newCylinderUnitPrice;
  next.exchangeLineTotal = lines.exchangeLineTotal;
  next.newCylinderLineTotal = lines.newCylinderLineTotal;
  next.deliveryFee = lines.deliveryFee;
  return next;
}
