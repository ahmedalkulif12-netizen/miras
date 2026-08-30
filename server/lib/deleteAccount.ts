import admin from 'firebase-admin';
import crypto from 'crypto';
import {
  OrderStatus,
  normalizeOrderStatus,
  appendStatusHistory,
} from './orderStatus.ts';

const REDACTED = '[redacted]';
const DELETED_DISPLAY_NAME = 'Deleted User';

/** Statuses that block deletion until the trip finishes. */
const BLOCKING_TRIP_STATUSES = new Set([
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  'accepted',
  'on_the_way',
  'arrived',
]);

export interface DeleteAccountInput {
  uid: string;
}

export interface DeleteAccountResult {
  success: true;
  uid: string;
  cancelledOrders: number;
  anonymizedOrders: number;
  alreadyDeleted?: boolean;
}

function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone.trim()).digest('hex').slice(0, 16);
}

function isTerminalOrderStatus(status: string): boolean {
  const normalized = normalizeOrderStatus(status);
  return (
    normalized === OrderStatus.COMPLETED ||
    normalized === OrderStatus.CANCELLED ||
    normalized === 'expired'
  );
}

function blocksAccountDeletion(status: string): boolean {
  const normalized = normalizeOrderStatus(status);
  return BLOCKING_TRIP_STATUSES.has(status) || BLOCKING_TRIP_STATUSES.has(normalized);
}

function shouldCancelOnDelete(status: string): boolean {
  return !isTerminalOrderStatus(status) && !blocksAccountDeletion(status);
}

/** Remove Firebase Auth user if it still exists (idempotent cleanup). */
async function ensureAuthUserRemoved(auth: admin.auth.Auth, uid: string): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === 'auth/user-not-found') return;
    throw error;
  }

  // Revoke refresh tokens first so stale sessions cannot call APIs mid-deletion.
  await auth.revokeRefreshTokens(uid);
  await auth.deleteUser(uid);
}

/**
 * P0-10: Secure account deletion — anonymize PII, preserve accounting records,
 * revoke sessions, and delete Firebase Auth user.
 */
export async function executeDeleteAccount(
  db: admin.firestore.Firestore,
  auth: admin.auth.Auth,
  input: DeleteAccountInput
): Promise<DeleteAccountResult> {
  const { uid } = input;
  const deletionRef = db.collection('account_deletions').doc(uid);

  const existingDeletion = await deletionRef.get();
  if (existingDeletion.exists) {
    await ensureAuthUserRemoved(auth, uid);
    return {
      success: true,
      uid,
      cancelledOrders: 0,
      anonymizedOrders: 0,
      alreadyDeleted: true,
    };
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw Object.assign(new Error('User profile not found'), { statusCode: 404 });
  }

  const userData = userSnap.data() as Record<string, unknown>;
  if (userData.accountStatus === 'deleted') {
    await deletionRef.set(
      {
        uid,
        role: userData.role ?? 'unknown',
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'user_requested',
        note: 'backfilled_from_tombstone',
      },
      { merge: true }
    );
    await ensureAuthUserRemoved(auth, uid);
    return {
      success: true,
      uid,
      cancelledOrders: 0,
      anonymizedOrders: 0,
      alreadyDeleted: true,
    };
  }

  const role = String(userData.role || '');
  if (role === 'admin') {
    throw Object.assign(new Error('Admin accounts cannot be self-deleted via this endpoint'), {
      statusCode: 403,
    });
  }

  const adminSnap = await db.collection('admins').doc(uid).get();
  if (adminSnap.exists) {
    throw Object.assign(new Error('Admin accounts cannot be self-deleted via this endpoint'), {
      statusCode: 403,
    });
  }

  if (role === 'driver') {
    const walletSnap = await db.collection('wallets').doc(uid).get();
    const balance = walletSnap.exists ? Number(walletSnap.data()?.balance) || 0 : 0;
    if (balance > 0) {
      throw Object.assign(
        new Error('Cannot delete account with pending wallet balance. Contact support.'),
        { statusCode: 409 }
      );
    }
  }

  const [customerOrdersSnap, driverOrdersSnap] = await Promise.all([
    db.collection('orders').where('userId', '==', uid).get(),
    db.collection('orders').where('driverId', '==', uid).get(),
  ]);

  for (const doc of [...customerOrdersSnap.docs, ...driverOrdersSnap.docs]) {
    const status = String(doc.data().status || '');
    if (blocksAccountDeletion(status)) {
      throw Object.assign(
        new Error(
          'Cannot delete account while an active trip is in progress. Complete or cancel the trip first.'
        ),
        { statusCode: 409 }
      );
    }
  }

  const batch = db.batch();
  const processedOrderIds = new Set<string>();
  let cancelledOrders = 0;
  let anonymizedOrders = 0;

  const processOrder = (doc: admin.firestore.QueryDocumentSnapshot) => {
    if (processedOrderIds.has(doc.id)) return;
    processedOrderIds.add(doc.id);

    const data = doc.data() as Record<string, unknown>;
    const status = String(data.status || '');

    if (shouldCancelOnDelete(status)) {
      batch.update(doc.ref, {
        status: OrderStatus.CANCELLED,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledReason: 'account_deleted',
        pickupAddress: REDACTED,
        dropoffAddress: REDACTED,
        statusHistory: appendStatusHistory(data.statusHistory, {
          status: OrderStatus.CANCELLED,
          by: uid,
          byRole: 'system',
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      cancelledOrders += 1;
      return;
    }

    if (normalizeOrderStatus(status) === OrderStatus.COMPLETED) {
      const updates: Record<string, unknown> = {
        pickupAddress: REDACTED,
        dropoffAddress: REDACTED,
        customerName: DELETED_DISPLAY_NAME,
        userAnonymized: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (data.pickup && typeof data.pickup === 'object') {
        updates.pickup = { ...(data.pickup as object), address: REDACTED };
      }
      if (data.destination && typeof data.destination === 'object') {
        updates.destination = { ...(data.destination as object), address: REDACTED };
      }
      if (data.driverId === uid) {
        updates.driverName = DELETED_DISPLAY_NAME;
        updates.driverPhone = REDACTED;
        updates.truckDetails = REDACTED;
        updates.driverAnonymized = true;
      }

      batch.update(doc.ref, updates);
      anonymizedOrders += 1;
    }
  };

  customerOrdersSnap.docs.forEach(processOrder);
  driverOrdersSnap.docs.forEach(processOrder);

  // Tombstone profile — keeps uid/role for historical order joins; strips PII.
  batch.set(
    userRef,
    {
      uid,
      accountStatus: 'deleted',
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      name: DELETED_DISPLAY_NAME,
      phone: REDACTED,
      role: role || 'customer',
      vehicleType: admin.firestore.FieldValue.delete(),
      vehicleOption: admin.firestore.FieldValue.delete(),
      plateNumber: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (role === 'driver') {
    const driverRef = db.collection('drivers').doc(uid);
    batch.set(
      driverRef,
      {
        uid,
        accountStatus: 'deleted',
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        name: DELETED_DISPLAY_NAME,
        phone: REDACTED,
        isOnline: false,
        vehicleType: admin.firestore.FieldValue.delete(),
        plateNumber: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const phone = String(userData.phone || '');
  batch.set(deletionRef, {
    uid,
    role,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    reason: 'user_requested',
    cancelledOrders,
    anonymizedOrders,
    ...(phone ? { phoneHash: hashPhone(phone) } : {}),
  });

  const subscriptionRef = db.collection('subscriptions').doc(uid);
  const subscriptionSnap = await subscriptionRef.get();
  if (subscriptionSnap.exists) {
    batch.delete(subscriptionRef);
  }

  await batch.commit();

  // Payments and wallet ledger entries are preserved for accounting (amounts, IDs, timestamps).
  await ensureAuthUserRemoved(auth, uid);

  return {
    success: true,
    uid,
    cancelledOrders,
    anonymizedOrders,
  };
}
