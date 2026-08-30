/**
 * Canonical order lifecycle (P0-12).
 * Primary statuses used in production Firestore documents.
 */

export const OrderStatus = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_AUTHORIZED: 'payment_authorized',
  BROADCASTING: 'broadcasting',
  ASSIGNED: 'assigned',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_TRANSIT: 'in_transit',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  /** Legacy / internal — still normalized from old documents */
  DRAFT: 'draft',
  QUOTED: 'quoted',
  EXPIRED: 'expired',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export type OrderActorRole = 'customer' | 'driver' | 'admin' | 'system';

export interface StatusHistoryEntry {
  status: OrderStatus | string;
  at: unknown;
  by: string;
  byRole: OrderActorRole;
}

/** Driver job feed — paid open offers (never unpaid `awaiting_payment` drafts).
 *  Must stay in sync with firestore.rules `isOpenOffer()` and the DriverDashboard query. */
export const DRIVER_OFFER_STATUSES: string[] = [
  OrderStatus.BROADCASTING,
  OrderStatus.PAYMENT_AUTHORIZED,
  'searching_driver',
  'pending',
];

/** Active trip — assigned driver */
export const DRIVER_ACTIVE_STATUSES: string[] = [
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  'accepted',
  'on_the_way',
  'arrived',
  'in_progress',
];

export const ACTIVE_TRACKING_STATUSES: string[] = [
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  'accepted',
  'on_the_way',
  'arrived',
];

export const TERMINAL_STATUSES: string[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
];

const TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.BROADCASTING, OrderStatus.CANCELLED],
  [OrderStatus.PAYMENT_AUTHORIZED]: [
    OrderStatus.BROADCASTING,
    OrderStatus.ASSIGNED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.BROADCASTING]: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  [OrderStatus.ASSIGNED]: [
    OrderStatus.DRIVER_ARRIVED,
    OrderStatus.IN_TRANSIT,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DRIVER_ARRIVED]: [OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED],
  [OrderStatus.IN_TRANSIT]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.EXPIRED]: [],
  // Legacy aliases normalized before transition checks
  pending: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  searching_driver: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  accepted: [OrderStatus.DRIVER_ARRIVED, OrderStatus.IN_TRANSIT, OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  on_the_way: [OrderStatus.DRIVER_ARRIVED, OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED],
  arrived: [OrderStatus.IN_TRANSIT, OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  in_progress: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
};

export function normalizeOrderStatus(raw: string | undefined | null): string {
  switch (raw) {
    case 'pending':
      // Legacy paid offers used `pending`. Unpaid checkout writes `awaiting_payment`.
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
    // Delivery-only (water tanker): skip pickup stop → go straight toward drop-off.
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

/** Map Firestore status → customer tracking UI (unchanged labels) */
export function mapOrderStatusToTrackingUI(
  status: string | undefined
): 'searching_driver' | 'on_the_way' | 'arrived' | 'completed' {
  const s = normalizeOrderStatus(status);
  if (s === OrderStatus.COMPLETED) return 'completed';
  if (s === OrderStatus.DRIVER_ARRIVED) return 'arrived';
  if (s === OrderStatus.IN_TRANSIT || s === OrderStatus.ASSIGNED) return 'on_the_way';
  return 'searching_driver';
}

/** Client-facing 4-step timeline: waiting → accepted → on the way → completed. */
export type ClientTimelineStep = 'waiting' | 'accepted' | 'on_the_way' | 'completed';

export function clientTimelineStep(status: string | undefined): ClientTimelineStep {
  const s = normalizeOrderStatus(status);
  if (s === OrderStatus.COMPLETED) return 'completed';
  if (s === OrderStatus.IN_TRANSIT || s === OrderStatus.DRIVER_ARRIVED) {
    return 'on_the_way';
  }
  if (s === OrderStatus.ASSIGNED) return 'accepted';
  return 'waiting';
}

export function orderStatusProgress(status: string | undefined): number {
  const s = normalizeOrderStatus(status);
  switch (s) {
    case OrderStatus.COMPLETED:
      return 50;
    case OrderStatus.IN_TRANSIT:
      return 40;
    case OrderStatus.DRIVER_ARRIVED:
      return 30;
    case OrderStatus.ASSIGNED:
      return 20;
    case OrderStatus.BROADCASTING:
    case OrderStatus.PAYMENT_AUTHORIZED:
      return 10;
    default:
      return 0;
  }
}

/** Keep the more advanced trip status when local + Firestore both fire. */
export function preferFresherOrderStatus(
  current: string | undefined,
  incoming: string | undefined
): string {
  if (!incoming) return current || '';
  if (!current) return incoming;
  return orderStatusProgress(incoming) >= orderStatusProgress(current) ? incoming : current;
}

export function isOpenOfferStatus(status: string | undefined): boolean {
  if (!status) return false;
  if (DRIVER_OFFER_STATUSES.includes(status)) return true;
  const normalized = normalizeOrderStatus(status);
  return (
    normalized === OrderStatus.BROADCASTING ||
    normalized === OrderStatus.PAYMENT_AUTHORIZED
  );
}

export function isActiveTripStatus(status: string | undefined): boolean {
  if (!status) return false;
  return DRIVER_ACTIVE_STATUSES.includes(status) || DRIVER_ACTIVE_STATUSES.includes(normalizeOrderStatus(status));
}

export function isTerminalOrderStatus(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = normalizeOrderStatus(status);
  return TERMINAL_STATUSES.includes(status) || TERMINAL_STATUSES.includes(normalized);
}

/** Primary driver CTA for active trip progression (P0-12 server transitions). */
export type DriverPrimaryAction =
  | 'accept'
  | 'arrived'
  | 'arrived_dropoff'
  | 'complete'
  | 'none';

import { isDeliveryOnlyOrder, isWaterTankerService } from '@/domain/waterTanker';

/**
 * Embedded map navigation phase for the driver dashboard.
 * - preview: incoming offer — show full pickup→dropoff route (or driver→dropoff for tankers)
 * - to_pickup: after accept — route toward client loading/pickup
 * - to_dropoff: after arrived at pickup — route toward dropoff/delivery
 * Water tankers skip pickup and always navigate to the customer drop-off.
 */
export type DriverNavPhase = 'idle' | 'preview' | 'to_pickup' | 'to_dropoff';

function resolveDeliveryOnly(
  serviceTypeOrOrder?: string | { serviceType?: string; deliveryOnly?: boolean; locationMode?: string } | null
): boolean {
  if (!serviceTypeOrOrder) return false;
  if (typeof serviceTypeOrOrder === 'string') {
    return isWaterTankerService(serviceTypeOrOrder);
  }
  return isDeliveryOnlyOrder(serviceTypeOrOrder);
}

export function getDriverNavPhase(
  status: string | undefined,
  serviceTypeOrOrder?: string | { serviceType?: string; deliveryOnly?: boolean; locationMode?: string } | null
): DriverNavPhase {
  if (!status) return 'idle';
  if (isOpenOfferStatus(status)) return 'preview';
  if (!isActiveTripStatus(status)) return 'idle';

  if (resolveDeliveryOnly(serviceTypeOrOrder)) return 'to_dropoff';

  const normalized = normalizeOrderStatus(status);
  if (normalized === OrderStatus.ASSIGNED) return 'to_pickup';
  if (
    normalized === OrderStatus.DRIVER_ARRIVED ||
    normalized === OrderStatus.IN_TRANSIT
  ) {
    return 'to_dropoff';
  }
  return 'idle';
}

export function getDriverPrimaryAction(
  status: string | undefined,
  serviceTypeOrOrder?: string | { serviceType?: string; deliveryOnly?: boolean; locationMode?: string } | null
): DriverPrimaryAction {
  if (!status) return 'none';
  if (isOpenOfferStatus(status)) return 'accept';

  const deliveryOnly = resolveDeliveryOnly(serviceTypeOrOrder);
  const normalized = normalizeOrderStatus(status);

  // Pre-filled tanker goes straight to the customer drop-off.
  if (deliveryOnly) {
    if (normalized === OrderStatus.ASSIGNED) return 'arrived_dropoff';
    if (
      normalized === OrderStatus.DRIVER_ARRIVED ||
      normalized === OrderStatus.IN_TRANSIT
    ) {
      return 'complete';
    }
    if (normalized === OrderStatus.COMPLETED) return 'none';
    return 'none';
  }

  if (normalized === OrderStatus.ASSIGNED) return 'arrived';
  if (normalized === OrderStatus.DRIVER_ARRIVED) return 'arrived_dropoff';
  if (normalized === OrderStatus.IN_TRANSIT) return 'complete';
  if (normalized === OrderStatus.COMPLETED) return 'none';
  return 'none';
}
