import axios from 'axios';
import admin from 'firebase-admin';
import { finalizeOrderFromCheckoutDraft } from './checkoutDraft.ts';

const MOYASAR_API_URL = 'https://api.moyasar.com/v1';
const PAID_STATUSES = new Set(['paid', 'authorized', 'captured']);

export function isMoyasarTestSecret(secret: string): boolean {
  return String(secret || '').startsWith('sk_test_');
}

export function isPaidPaymentStatus(status: unknown): boolean {
  return PAID_STATUSES.has(String(status || '').toLowerCase());
}

async function fetchMoyasarPaymentStatus(
  secretKey: string,
  moyasarId: string
): Promise<string | null> {
  const auth = { username: secretKey, password: '' };
  try {
    const response = await axios.get(`${MOYASAR_API_URL}/payments/${moyasarId}`, {
      auth,
      timeout: 12_000,
    });
    return String(response.data?.status || '').toLowerCase() || null;
  } catch {
    try {
      const invoice = await axios.get(`${MOYASAR_API_URL}/invoices/${moyasarId}`, {
        auth,
        timeout: 12_000,
      });
      return String(invoice.data?.status || '').toLowerCase() || null;
    } catch (error) {
      console.warn('[payments] Moyasar fetch failed for', moyasarId, error);
      return null;
    }
  }
}

/**
 * After Moyasar return (including test keys): mark the payment paid and
 * write a broadcasting `orders` document so clients and drivers see it.
 */
export async function finalizePaidCheckoutReturn(
  db: admin.firestore.Firestore,
  input: {
    uid: string;
    draftId: string;
    moyasarId: string;
    returnStatus?: string;
    moyasarSecretKey: string;
  }
): Promise<{
  success: boolean;
  orderId: string;
  paymentStatus: string;
  orderStatus: string;
  startTracking: boolean;
  testMode: boolean;
  message?: string;
}> {
  const testMode = isMoyasarTestSecret(input.moyasarSecretKey);
  const callbackPaid = isPaidPaymentStatus(input.returnStatus);
  let remoteStatus = await fetchMoyasarPaymentStatus(
    input.moyasarSecretKey,
    input.moyasarId
  );

  const paidOk =
    isPaidPaymentStatus(remoteStatus) ||
    (testMode && callbackPaid) ||
    (testMode && !input.returnStatus && isPaidPaymentStatus(remoteStatus));

  if (!paidOk && testMode && callbackPaid) {
    remoteStatus = String(input.returnStatus || 'paid').toLowerCase();
  }

  if (!paidOk && !isPaidPaymentStatus(remoteStatus) && !(testMode && callbackPaid)) {
    return {
      success: false,
      orderId: input.draftId,
      paymentStatus: remoteStatus || String(input.returnStatus || 'pending'),
      orderStatus: 'awaiting_payment',
      startTracking: false,
      testMode,
      message: 'Payment is not authorized yet',
    };
  }

  const resolvedStatus = isPaidPaymentStatus(remoteStatus)
    ? remoteStatus!
    : 'paid';

  let paymentDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;
  const paymentsQuery = await db
    .collection('payments')
    .where('transactionId', '==', input.moyasarId)
    .limit(1)
    .get();

  if (paymentsQuery.empty) {
    const createdRef = db.collection('payments').doc();
    await createdRef.set({
      userId: input.uid,
      draftId: input.draftId,
      orderId: null,
      status: 'authorized',
      transactionId: input.moyasarId,
      testMode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    paymentDoc = await createdRef.get();
  } else {
    paymentDoc = paymentsQuery.docs[0];
  }

  const payment = (paymentDoc.data() || {}) as Record<string, unknown>;
  if (payment.userId && payment.userId !== input.uid) {
    throw Object.assign(new Error('Payment does not belong to authenticated user'), {
      statusCode: 403,
    });
  }
  if (payment.draftId && String(payment.draftId) !== input.draftId) {
    throw Object.assign(new Error('Payment does not match checkout draft'), {
      statusCode: 403,
    });
  }

  await paymentDoc.ref.set(
    {
      status: 'authorized',
      moyasarStatus: resolvedStatus,
      testMode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const finalized = await finalizeOrderFromCheckoutDraft(db, {
    userId: input.uid,
    draftId: input.draftId,
    paymentId: paymentDoc.id,
    moyasarId: input.moyasarId,
    testMode,
  });

  await paymentDoc.ref.set(
    {
      orderId: finalized.orderId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    success: true,
    orderId: finalized.orderId,
    paymentStatus: 'authorized',
    orderStatus: finalized.status,
    startTracking: true,
    testMode,
  };
}
