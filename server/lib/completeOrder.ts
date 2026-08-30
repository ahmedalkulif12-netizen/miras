import admin from 'firebase-admin';
import {
  OrderStatus,
  normalizeOrderStatus,
  appendStatusHistory,
} from './orderStatus.ts';
import {
  creditWalletForCompletedTrip,
  readOrderTripMoney,
} from './driverWallet.ts';

export interface CompleteOrderInput {
  orderId: string;
  driverId: string;
}

export interface CompleteOrderResult {
  success: true;
  orderId: string;
  status: string;
  alreadyCompleted?: boolean;
  wallet: {
    balance: number;
    totalEarnings: number;
    platformCommission: number;
    netEarnings: number;
    creditedNet: number;
  };
}

const COMPLETABLE = [
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  'accepted',
  'arrived',
  'on_the_way',
];

/**
 * Driver completes a trip. Wallet credit uses order.financials only (idempotent).
 */
export async function executeCompleteOrder(
  db: admin.firestore.Firestore,
  input: CompleteOrderInput
): Promise<CompleteOrderResult> {
  const { orderId, driverId } = input;
  const orderRef = db.collection('orders').doc(orderId);
  const walletRef = db.collection('wallets').doc(driverId);

  return db.runTransaction(async (tx) => {
    const [orderSnap, walletSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(walletRef),
    ]);

    if (!orderSnap.exists) {
      throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    }

    const order = orderSnap.data() as Record<string, unknown>;
    const orderDriverId = String(order.driverId || '');
    if (orderDriverId && orderDriverId !== driverId) {
      throw Object.assign(new Error('Order assigned to another driver'), {
        statusCode: 403,
      });
    }
    if (!orderDriverId) {
      throw Object.assign(new Error('Order is not assigned to a driver'), {
        statusCode: 400,
      });
    }

    const money = readOrderTripMoney(order);
    if (money.tripFare <= 0 && money.driverNet <= 0) {
      throw Object.assign(new Error('Order has no financials to credit'), {
        statusCode: 400,
      });
    }

    const alreadyCredited = order.walletCredited === true;
    const status = String(order.status || '');
    const normalized = normalizeOrderStatus(status);
    const isCompleted =
      status === OrderStatus.COMPLETED || normalized === OrderStatus.COMPLETED;

    if (isCompleted && alreadyCredited) {
      const current = walletSnap.exists
        ? (walletSnap.data() as Record<string, unknown>)
        : {};
      return {
        success: true as const,
        orderId,
        status: OrderStatus.COMPLETED,
        alreadyCompleted: true,
        wallet: {
          balance: Number(current.balance) || 0,
          totalEarnings: Number(current.totalEarnings) || 0,
          platformCommission: Number(current.platformCommission) || 0,
          netEarnings: Number(current.netEarnings) || 0,
          creditedNet: 0,
        },
      };
    }

    if (!isCompleted) {
      if (!COMPLETABLE.includes(status) && !COMPLETABLE.includes(normalized)) {
        throw Object.assign(
          new Error(`Order not ready for completion (status: ${status})`),
          { statusCode: 400 }
        );
      }
    }

    const statusHistory = appendStatusHistory(order.statusHistory, {
      status: OrderStatus.COMPLETED,
      by: driverId,
      byRole: 'driver',
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(orderRef, {
      status: OrderStatus.COMPLETED,
      driverId,
      walletCredited: true,
      walletCreditedAt: now,
      statusHistory,
      updatedAt: now,
    });

    const wallet = alreadyCredited
      ? {
          balance: Number((walletSnap.data() as { balance?: number })?.balance) || 0,
          totalEarnings:
            Number((walletSnap.data() as { totalEarnings?: number })?.totalEarnings) ||
            0,
          platformCommission:
            Number(
              (walletSnap.data() as { platformCommission?: number })?.platformCommission
            ) || 0,
          netEarnings:
            Number((walletSnap.data() as { netEarnings?: number })?.netEarnings) || 0,
          creditedNet: 0,
        }
      : creditWalletForCompletedTrip(tx, walletRef, walletSnap, {
          driverId,
          ...money,
        });

    return {
      success: true as const,
      orderId,
      status: OrderStatus.COMPLETED,
      alreadyCompleted: isCompleted,
      wallet: {
        balance: wallet.balance,
        totalEarnings: wallet.totalEarnings,
        platformCommission: wallet.platformCommission,
        netEarnings: wallet.netEarnings,
        creditedNet: alreadyCredited ? 0 : money.driverNet,
      },
    };
  });
}
