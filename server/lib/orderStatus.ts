import admin from 'firebase-admin';

export type OrderActorRole = 'customer' | 'driver' | 'admin' | 'system';

/** Re-export transition rules for server (mirrors src/domain/order-status.ts). */
const OrderStatus = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_AUTHORIZED: 'payment_authorized',
  BROADCASTING: 'broadcasting',
  ASSIGNED: 'assigned',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_TRANSIT: 'in_transit',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

function normalizeOrderStatus(raw: string | undefined | null): string {
  switch (raw) {
    case 'pending':
      return OrderStatus.BROADCASTING;
    case 'searching_driver':
      return OrderStatus.BROADCASTING;
    case 'accepted':
      return OrderStatus.ASSIGNED;
    case 'on_the_way':
    case 'navigating_pickup':
      return OrderStatus.ASSIGNED;
    case 'arrived':
    case 'at_pickup':
      return OrderStatus.DRIVER_ARRIVED;
    case 'at_dropoff':
    case 'in_progress':
    case 'in-progress':
      return OrderStatus.IN_TRANSIT;
    case 'completed':
      return OrderStatus.COMPLETED;
    default:
      return raw || OrderStatus.AWAITING_PAYMENT;
  }
}

const TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.AWAITING_PAYMENT]: [
    OrderStatus.PAYMENT_AUTHORIZED,
    OrderStatus.BROADCASTING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_AUTHORIZED]: [
    OrderStatus.BROADCASTING,
    OrderStatus.ASSIGNED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.BROADCASTING]: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  // IN_TRANSIT allowed from ASSIGNED for delivery-only (water tanker → client directly).
  [OrderStatus.ASSIGNED]: [
    OrderStatus.DRIVER_ARRIVED,
    OrderStatus.IN_TRANSIT,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DRIVER_ARRIVED]: [OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED],
  [OrderStatus.IN_TRANSIT]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  pending: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  searching_driver: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  in_progress: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
};

export function canTransition(fromRaw: string, toRaw: string): boolean {
  const from = normalizeOrderStatus(fromRaw);
  const to = normalizeOrderStatus(toRaw);
  const allowed = TRANSITIONS[from] || TRANSITIONS[fromRaw];
  if (!allowed) return false;
  return allowed.includes(to) || allowed.includes(toRaw);
}

export function canRoleTransition(
  role: OrderActorRole,
  fromRaw: string,
  toRaw: string
): boolean {
  if (!canTransition(fromRaw, toRaw)) return false;
  if (role === 'admin' || role === 'system') return true;

  const from = normalizeOrderStatus(fromRaw);
  const to = normalizeOrderStatus(toRaw);

  if (role === 'driver') {
    if (
      (from === OrderStatus.BROADCASTING || from === OrderStatus.PAYMENT_AUTHORIZED) &&
      to === OrderStatus.ASSIGNED
    ) {
      return true;
    }
    if (from === OrderStatus.ASSIGNED && to === OrderStatus.DRIVER_ARRIVED) return true;
    if (from === OrderStatus.ASSIGNED && to === OrderStatus.IN_TRANSIT) return true;
    if (from === OrderStatus.DRIVER_ARRIVED && to === OrderStatus.IN_TRANSIT) return true;
    if (from === OrderStatus.IN_TRANSIT && to === OrderStatus.COMPLETED) return true;
    return false;
  }

  if (role === 'customer') {
    return to === OrderStatus.CANCELLED;
  }

  return false;
}

export function appendStatusHistory(
  existing: unknown,
  entry: { status: string; by: string; byRole: OrderActorRole }
) {
  const history = Array.isArray(existing) ? [...existing] : [];
  history.push({
    status: entry.status,
    at: admin.firestore.FieldValue.serverTimestamp(),
    by: entry.by,
    byRole: entry.byRole,
  });
  return history;
}

const ACTIVE_TRIP_STATUSES = [
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  'assigned',
  'driver_arrived',
  'in_transit',
  'accepted',
  'on_the_way',
  'arrived',
  'at_pickup',
  'at_dropoff',
  'in_progress',
];

export function isActiveTripStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  const normalized = normalizeOrderStatus(status);
  return ACTIVE_TRIP_STATUSES.includes(status) || ACTIVE_TRIP_STATUSES.includes(normalized);
}

export { normalizeOrderStatus, OrderStatus };
