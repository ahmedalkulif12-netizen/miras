import admin from 'firebase-admin';
import {
  OrderStatus,
  normalizeOrderStatus,
  canRoleTransition,
  appendStatusHistory,
} from './orderStatus.ts';
import { driverMatchesRequiredVehicle } from './serviceCategories.ts';

export interface AcceptOrderInput {
  orderId: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  truckDetails: string;
  /** Canonical vehicle category from verifyApprovedDriverAccess — required for match. */
  vehicleType: string | null;
}

export interface AcceptOrderResult {
  success: true;
  orderId: string;
  status: string;
  alreadyAssigned?: boolean;
}

/**
 * Atomic driver accept — first driver wins (P0-12).
 * Enforces vehicle-type ↔ order.serviceType match before assignment.
 */
export async function executeAcceptOrder(
  db: admin.firestore.Firestore,
  input: AcceptOrderInput
): Promise<AcceptOrderResult> {
  const { orderId, driverId, driverName, driverPhone, truckDetails, vehicleType } = input;
  const orderRef = db.collection('orders').doc(orderId);

  return db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    }

    const order = orderSnap.data() as Record<string, unknown>;
    const currentStatus = String(order.status || '');
    const normalized = normalizeOrderStatus(currentStatus);
    const requiredVehicle =
      String(order.requiredVehicleType || order.serviceType || '');

    // Strict category match — never allow flatbed driver to take furniture, etc.
    if (!driverMatchesRequiredVehicle(vehicleType, order)) {
      throw Object.assign(
        new Error(
          `Vehicle type mismatch: driver=${vehicleType || 'none'} order=${requiredVehicle || 'none'}`
        ),
        { statusCode: 403, code: 'VEHICLE_TYPE_MISMATCH' }
      );
    }

    // Idempotent: same driver already assigned
    if (order.driverId === driverId && normalized === OrderStatus.ASSIGNED) {
      return {
        success: true as const,
        orderId,
        status: OrderStatus.ASSIGNED,
        alreadyAssigned: true,
      };
    }

    // Reject if another driver already assigned
    if (
      order.driverId &&
      order.driverId !== driverId &&
      String(order.driverId).length > 0
    ) {
      throw Object.assign(new Error('Order already assigned to another driver'), {
        statusCode: 409,
      });
    }

    // Must be open for dispatch — only after payment (broadcasting / authorized)
    const openStatuses = [
      OrderStatus.BROADCASTING,
      'broadcasting',
      'searching_driver',
      'pending',
      OrderStatus.PAYMENT_AUTHORIZED,
    ];
    if (
      !openStatuses.includes(currentStatus) &&
      normalized !== OrderStatus.BROADCASTING &&
      normalized !== OrderStatus.PAYMENT_AUTHORIZED
    ) {
      throw Object.assign(
        new Error(`Order is not available for accept (status: ${currentStatus})`),
        { statusCode: 400 }
      );
    }

    if (!canRoleTransition('driver', currentStatus, OrderStatus.ASSIGNED)) {
      throw Object.assign(new Error('Invalid transition for accept'), { statusCode: 400 });
    }

    const statusHistory = appendStatusHistory(order.statusHistory, {
      status: OrderStatus.ASSIGNED,
      by: driverId,
      byRole: 'driver',
    });

    transaction.update(orderRef, {
      status: OrderStatus.ASSIGNED,
      driverId,
      driver: {
        id: driverId,
        name: driverName,
        phone: driverPhone,
        truckDetails,
        vehicleType: vehicleType || null,
      },
      driverPhone,
      statusHistory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true as const,
      orderId,
      status: OrderStatus.ASSIGNED,
    };
  });
}

export interface TransitionOrderInput {
  orderId: string;
  driverId: string;
  toStatus: string;
}

/**
 * Driver trip progression with role-based validation.
 */
export async function executeTransitionOrder(
  db: admin.firestore.Firestore,
  input: TransitionOrderInput
): Promise<{ success: true; status: string }> {
  const { orderId, driverId, toStatus } = input;
  const orderRef = db.collection('orders').doc(orderId);

  return db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    }

    const order = orderSnap.data() as Record<string, unknown>;
    if (order.driverId !== driverId) {
      throw Object.assign(new Error('Not assigned to this driver'), { statusCode: 403 });
    }

    const fromStatus = String(order.status || '');

    if (!canRoleTransition('driver', fromStatus, toStatus)) {
      throw Object.assign(
        new Error(`Invalid transition: ${fromStatus} -> ${toStatus}`),
        { statusCode: 400 }
      );
    }

    const statusHistory = appendStatusHistory(order.statusHistory, {
      status: toStatus,
      by: driverId,
      byRole: 'driver',
    });

    transaction.update(orderRef, {
      status: toStatus,
      statusHistory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true as const, status: toStatus };
  });
}

/**
 * After Moyasar authorization — move order to driver pool.
 */
export async function executePaymentAuthorizedToBroadcasting(
  db: admin.firestore.Firestore,
  orderId: string
): Promise<void> {
  const orderRef = db.collection('orders').doc(orderId);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) return;

    const order = snap.data() as Record<string, unknown>;
    const from = String(order.status || '');

    if (normalizeOrderStatus(from) === OrderStatus.BROADCASTING) return;
    if (normalizeOrderStatus(from) === OrderStatus.COMPLETED) return;

    const history = appendStatusHistory(order.statusHistory, {
      status: OrderStatus.BROADCASTING,
      by: 'system',
      byRole: 'system',
    });

    transaction.update(orderRef, {
      status: OrderStatus.BROADCASTING,
      paymentStatus: 'authorized',
      statusHistory: history,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}
