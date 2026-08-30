import admin from 'firebase-admin';
import { normalizeOrderStatus, OrderStatus } from './orderStatus.ts';

export interface PaymentReturnInput {
  uid: string;
  orderId: string;
  moyasarId?: string;
  returnStatus?: string;
}

export interface PaymentReturnResult {
  success: boolean;
  orderId: string;
  paymentStatus: string;
  orderStatus: string;
  startTracking: boolean;
  message?: string;
}

const TRACKABLE_ORDER_STATUSES = new Set([
  OrderStatus.PAYMENT_AUTHORIZED,
  OrderStatus.BROADCASTING,
  OrderStatus.ASSIGNED,
  OrderStatus.DRIVER_ARRIVED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.COMPLETED,
  'payment_authorized',
  'broadcasting',
  'searching_driver',
  'pending',
  'in_progress',
]);

/**
 * Secure Moyasar return handler — validates ownership and persisted payment state.
 * Webhook may still be processing; authorized/pending states allow tracking UI entry.
 */
export async function verifyPaymentReturnStatus(
  db: admin.firestore.Firestore,
  input: PaymentReturnInput
): Promise<PaymentReturnResult> {
  const { uid, orderId, moyasarId, returnStatus } = input;

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw Object.assign(new Error('Order not found'), { statusCode: 404 });
  }

  const order = orderSnap.data() as Record<string, unknown>;
  if (order.userId !== uid) {
    throw Object.assign(new Error('Order does not belong to authenticated user'), { statusCode: 403 });
  }

  if (returnStatus && ['failed', 'voided', 'cancelled'].includes(returnStatus.toLowerCase())) {
    return {
      success: false,
      orderId,
      paymentStatus: String(order.paymentStatus || 'failed'),
      orderStatus: String(order.status || OrderStatus.AWAITING_PAYMENT),
      startTracking: false,
      message: 'Payment was not completed',
    };
  }

  let paymentStatus = String(order.paymentStatus || 'pending');
  const orderStatus = String(order.status || OrderStatus.AWAITING_PAYMENT);
  const normalized = normalizeOrderStatus(orderStatus);

  if (moyasarId) {
    const paymentsQuery = await db
      .collection('payments')
      .where('transactionId', '==', moyasarId)
      .limit(1)
      .get();

    if (!paymentsQuery.empty) {
      const payment = paymentsQuery.docs[0].data() as Record<string, unknown>;
      if (payment.userId !== uid) {
        throw Object.assign(new Error('Payment does not belong to authenticated user'), { statusCode: 403 });
      }
      paymentStatus = String(payment.status || paymentStatus);
    }
  }

  const paymentOk = ['authorized', 'captured', 'paid'].includes(paymentStatus);
  // Do not treat bare "pending" as ready for tracking.
  const orderReady =
    TRACKABLE_ORDER_STATUSES.has(orderStatus) ||
    TRACKABLE_ORDER_STATUSES.has(normalized);

  const startTracking = paymentOk && orderReady;

  return {
    success: startTracking,
    orderId,
    paymentStatus,
    orderStatus,
    startTracking,
    message: startTracking
      ? undefined
      : 'Payment received — waiting for authorization. Tracking will start shortly.',
  };
}
