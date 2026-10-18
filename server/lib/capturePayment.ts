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
import {
  driverCompletedCountFields,
  resolveOrderDriverCommission,
} from './driverCommission.ts';

export interface CapturePaymentInput {
  paymentId: string;
  orderId: string;
  driverId: string;
}

export interface CapturePaymentResult {
  success: true;
  capturedAmount: number;
  alreadyCaptured?: boolean;
}

/**
 * Idempotent capture: validates driver ownership and prevents double wallet credit.
 */
export async function executeCapturePayment(
  db: admin.firestore.Firestore,
  input: CapturePaymentInput
): Promise<CapturePaymentResult> {
  const { paymentId, orderId, driverId } = input;

  const paymentRef = db.collection('payments').doc(paymentId);
  const orderRef = db.collection('orders').doc(orderId);
  const walletRef = db.collection('wallets').doc(driverId);

  return db.runTransaction(async (transaction) => {
    const [paymentSnap, orderSnap, walletSnap] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(orderRef),
      transaction.get(walletRef),
    ]);

    if (!paymentSnap.exists) {
      throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
    }
    if (!orderSnap.exists) {
      throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    }

    const paymentData = paymentSnap.data() as Record<string, unknown>;
    const orderData = orderSnap.data() as Record<string, unknown>;

    if (paymentData.status === 'captured') {
      return { success: true as const, capturedAmount: Number(paymentData.amount) || 0, alreadyCaptured: true };
    }

    const orderDriverId = orderData.driverId as string | undefined;
    if (orderDriverId && orderDriverId !== driverId) {
      throw Object.assign(new Error('Order assigned to another driver'), { statusCode: 403 });
    }

    const linkedOrderId = paymentData.orderId as string | undefined;
    if (linkedOrderId && linkedOrderId !== 'pending' && linkedOrderId !== orderId) {
      throw Object.assign(new Error('Payment linked to a different order'), { statusCode: 403 });
    }

    const orderPaymentId = orderData.paymentId as string | undefined;
    if (orderPaymentId && orderPaymentId !== paymentId) {
      throw Object.assign(new Error('Order payment mismatch'), { statusCode: 403 });
    }

    const allowedStatuses = ['authorized', 'pending'];
    if (!allowedStatuses.includes(String(paymentData.status))) {
      throw Object.assign(new Error('Payment not in valid state for capture'), { statusCode: 400 });
    }

    const quoted = readOrderTripMoney(orderData);
    const walletData = walletSnap.exists
      ? (walletSnap.data() as Record<string, unknown>)
      : null;
    const loyalty = await resolveOrderDriverCommission(
      db,
      transaction,
      orderData,
      driverId,
      walletData
    );
    const money = {
      tripFare: loyalty.financials.tripFare || quoted.tripFare,
      platformFee: loyalty.financials.platformFee,
      driverNet: loyalty.financials.driverNet,
    };
    const capturedAmount = Number(paymentData.amount) || quoted.tripFare;

    transaction.update(paymentRef, {
      status: 'captured',
      orderId,
      driverId,
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const orderStatus = String(orderData.status || '');
    const normalized = normalizeOrderStatus(orderStatus);
    const alreadyCompleted =
      orderStatus === OrderStatus.COMPLETED || normalized === OrderStatus.COMPLETED;
    const completable = [
      OrderStatus.ASSIGNED,
      OrderStatus.DRIVER_ARRIVED,
      OrderStatus.IN_TRANSIT,
      'accepted',
      'arrived',
      'on_the_way',
    ];
    if (
      !alreadyCompleted &&
      !completable.includes(orderStatus) &&
      !completable.includes(normalized)
    ) {
      throw Object.assign(
        new Error(`Order not ready for completion (status: ${orderStatus})`),
        { statusCode: 400 }
      );
    }

    const statusHistory = alreadyCompleted
      ? orderData.statusHistory
      : appendStatusHistory(orderData.statusHistory, {
          status: OrderStatus.COMPLETED,
          by: driverId,
          byRole: 'driver',
        });

    const alreadyCredited = orderData.walletCredited === true;
    const capturedAt = admin.firestore.FieldValue.serverTimestamp();
    transaction.update(orderRef, {
      ...(alreadyCredited ? {} : loyalty.moneyFields),
      status: OrderStatus.COMPLETED,
      paymentStatus: 'captured',
      driverId,
      walletCredited: true,
      walletCreditedAt: capturedAt,
      ...(statusHistory !== undefined ? { statusHistory } : {}),
      updatedAt: capturedAt,
    });

    if (!alreadyCredited) {
      transaction.set(
        db.collection('drivers').doc(driverId),
        {
          ...driverCompletedCountFields(loyalty.completedOrdersCount + 1),
          updatedAt: capturedAt,
        },
        { merge: true }
      );
    }

    if (!alreadyCredited && money.driverNet > 0) {
      creditWalletForCompletedTrip(transaction, walletRef, walletSnap, {
        driverId,
        ...money,
      });
    }

    return { success: true as const, capturedAmount };
  });
}
