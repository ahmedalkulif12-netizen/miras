import admin from 'firebase-admin';
import { isActiveTripStatus, normalizeOrderStatus } from './orderStatus.ts';
import { isDemoDocumentId, isTestOrGhostRecord } from './testDataPatterns.ts';
import { timestampToIso, timestampToMs } from './timestamps.ts';
import type { AdminDriverRow } from './adminDrivers.ts';

/** Canonical + legacy statuses that must appear in the admin orders inbox. */
export const ADMIN_VISIBLE_ORDER_STATUSES = [
  'awaiting_payment',
  'payment_authorized',
  'broadcasting',
  'pending',
  'searching_driver',
  'assigned',
  'accepted',
  'on_the_way',
  'navigating_pickup',
  'driver_arrived',
  'arrived',
  'at_pickup',
  'in_transit',
  'in_progress',
  'in-progress',
  'at_dropoff',
  'completed',
  'cancelled',
] as const;

const REVIEW_QUEUE_STATUSES = new Set(['pending', 'pending_review', 'ready_for_review']);

export type AdminFeedKind = 'order' | 'driver_registration';

export interface AdminFeedItem {
  id: string;
  kind: AdminFeedKind;
  userId: string;
  customerName?: string | null;
  serviceType: string;
  amount: number;
  status: string;
  waterType?: string | null;
  capacity?: string | null;
  serviceOption?: string | null;
  vehicleFieldNotes?: Record<string, unknown> | null;
  createdAt?: string | null;
}

export function orderSortMs(data: Record<string, unknown>): number {
  return (
    timestampToMs(data.createdAt) ||
    timestampToMs(data.promotedAt) ||
    timestampToMs(data.updatedAt) ||
    timestampToMs(data.submittedAt) ||
    0
  );
}

function isLivePaidOrder(data: Record<string, unknown>): boolean {
  const status = String(data.status || '');
  const normalized = normalizeOrderStatus(status);
  const payment = String(data.paymentStatus || '').toLowerCase();
  if (payment === 'authorized' || payment === 'captured' || payment === 'paid') return true;
  if (normalized === 'awaiting_payment' && payment !== 'authorized' && payment !== 'captured') {
    return false;
  }
  return (
    normalized === 'broadcasting' ||
    normalized === 'payment_authorized' ||
    normalized === 'assigned' ||
    normalized === 'driver_arrived' ||
    normalized === 'in_transit' ||
    normalized === 'completed' ||
    isActiveTripStatus(status)
  );
}

/**
 * Hide synthetic E2E/demo rows — but never drop a real paid/live order just because
 * checkout reused a `draft-*` document id or the client historically set localSharedE2E.
 */
export function isGhostAdminOrder(id: string, data: Record<string, unknown>): boolean {
  const live = isLivePaidOrder(data);
  if (live && String(id).toLowerCase().startsWith('draft-')) {
    return isTestOrGhostRecord({
      uid: data.userId || id,
      userId: data.userId,
      driverId: data.driverId,
      phone: data.phone || data.customerPhone,
      name: data.customerName,
      fullName: data.customerName,
    });
  }
  if (isDemoDocumentId(id)) return true;
  return isTestOrGhostRecord({
    uid: id,
    userId: data.userId,
    driverId: data.driverId,
    phone: data.phone || data.customerPhone,
    name: data.customerName || data.name,
    fullName: data.customerName,
  });
}

function readAmount(order: Record<string, unknown>): number {
  const financials = order.financials as Record<string, unknown> | undefined;
  return Number(financials?.customerTotal ?? order.totalPrice ?? order.price ?? 0) || 0;
}

export function mapOrderDocToFeedItem(
  id: string,
  data: Record<string, unknown>
): AdminFeedItem {
  const serviceDetails = (data.serviceDetails || {}) as Record<string, unknown>;
  return {
    id,
    kind: 'order',
    userId: String(data.userId || data.clientId || data.customerId || ''),
    customerName: data.customerName != null ? String(data.customerName) : null,
    serviceType: String(data.serviceType || 'unknown'),
    amount: readAmount(data),
    status: String(data.status || ''),
    waterType: serviceDetails.waterType != null ? String(serviceDetails.waterType) : null,
    capacity:
      serviceDetails.capacity != null
        ? String(serviceDetails.capacity)
        : serviceDetails.type != null
          ? String(serviceDetails.type)
          : null,
    serviceOption: serviceDetails.type != null ? String(serviceDetails.type) : null,
    vehicleFieldNotes:
      (data.vehicleFieldNotes as Record<string, unknown> | undefined) ||
      (serviceDetails.vehicleFieldNotes as Record<string, unknown> | undefined) ||
      null,
    createdAt: timestampToIso(data.createdAt || data.promotedAt || data.updatedAt),
  };
}

export function mapDriverApplicationToFeedItem(row: AdminDriverRow): AdminFeedItem {
  return {
    id: `driver:${row.id}`,
    kind: 'driver_registration',
    userId: row.id,
    customerName: row.name,
    serviceType: 'driver_registration',
    amount: 0,
    status: row.status,
    createdAt: row.createdAt || null,
  };
}

export function mergeAdminFeed(
  orders: AdminFeedItem[],
  driverApplications: AdminFeedItem[],
  limit = 40
): AdminFeedItem[] {
  const byTime = (a: AdminFeedItem, b: AdminFeedItem) =>
    (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0);
  const orderPart = [...orders].sort(byTime).slice(0, Math.max(20, limit - 15));
  const driverPart = [...driverApplications].sort(byTime).slice(0, 15);
  return [...orderPart, ...driverPart].sort(byTime).slice(0, limit);
}

async function safeQuery(
  label: string,
  run: () => Promise<admin.firestore.QuerySnapshot>
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  try {
    const snap = await run();
    return snap.docs;
  } catch (error) {
    console.warn(`[admin-orders] ${label} query skipped:`, error);
    return [];
  }
}

/**
 * Load transport orders for admin without requiring createdAt or a single status.
 * Merges an unscoped scan with recency + status queries so missing fields still appear.
 */
export async function listAdminOrderDocuments(
  db: admin.firestore.Firestore,
  limit = 400
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  const add = (docs: admin.firestore.QueryDocumentSnapshot[]) => {
    docs.forEach((doc) => byId.set(doc.id, doc));
  };

  const statusBatches: string[][] = [];
  for (let i = 0; i < ADMIN_VISIBLE_ORDER_STATUSES.length; i += 10) {
    statusBatches.push(ADMIN_VISIBLE_ORDER_STATUSES.slice(i, i + 10) as unknown as string[]);
  }

  const [unscoped, byCreated, byUpdated, ...statusSnaps] = await Promise.all([
    safeQuery('unscoped', () => db.collection('orders').limit(limit).get()),
    safeQuery('createdAt', () =>
      db.collection('orders').orderBy('createdAt', 'desc').limit(limit).get()
    ),
    safeQuery('updatedAt', () =>
      db.collection('orders').orderBy('updatedAt', 'desc').limit(limit).get()
    ),
    ...statusBatches.map((statuses, index) =>
      safeQuery(`status-in-${index}`, () =>
        db.collection('orders').where('status', 'in', statuses).limit(100).get()
      )
    ),
  ]);

  add(unscoped);
  add(byCreated);
  add(byUpdated);
  statusSnaps.forEach(add);

  return Array.from(byId.values()).sort((a, b) => {
    const dataA = a.data() as Record<string, unknown>;
    const dataB = b.data() as Record<string, unknown>;
    return orderSortMs(dataB) - orderSortMs(dataA);
  });
}

export function isReviewQueueDriverStatus(status: string | undefined | null): boolean {
  return REVIEW_QUEUE_STATUSES.has(String(status || ''));
}
