import admin from 'firebase-admin';
import { finalizeOrderFromCheckoutDraft } from './checkoutDraft.ts';
import {
  formatTapChargeLog,
  isPaidTapStatus,
  isTapTestSecret,
  retrieveTapCharge,
  tapChargeOutcome,
} from './tapPayments.ts';

export { isTapTestSecret };

function draftIdFromCharge(charge: Record<string, unknown> | null): string {
  if (!charge) return '';
  const metadata = (charge.metadata || {}) as Record<string, unknown>;
  const reference = (charge.reference || {}) as Record<string, unknown>;
  return String(metadata.draftId || reference.transaction || reference.order || '').trim();
}

async function ownedCheckoutDraftId(
  db: admin.firestore.Firestore,
  uid: string,
  candidate: string
): Promise<string> {
  const id = String(candidate || '').trim();
  if (!id) return '';
  const snap = await db.collection('checkout_drafts').doc(id).get();
  if (!snap.exists) return '';
  const owner = String((snap.data() as { userId?: string } | undefined)?.userId || '');
  if (owner && owner !== uid) return '';
  return id;
}

export function isPaidPaymentStatus(status: unknown): boolean {
  return isPaidTapStatus(status);
}

/**
 * After Tap redirect: confirm the charge with Tap, then write a broadcasting
 * `orders` document so clients and drivers see it.
 */
export async function finalizePaidCheckoutReturn(
  db: admin.firestore.Firestore,
  input: {
    uid: string;
    draftId: string;
    tapChargeId: string;
    returnStatus?: string;
    tapSecretKey: string;
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
  const testMode = isTapTestSecret(input.tapSecretKey);
  let remote = await retrieveTapCharge(input.tapSecretKey, input.tapChargeId);
  let outcome = tapChargeOutcome(remote);
  console.info(
    '[payments] tap return',
    JSON.stringify({
      ...formatTapChargeLog(input.tapChargeId, outcome, Boolean(remote)),
      queryStatus: input.returnStatus || null,
      draftId: input.draftId,
      attempt: 0,
    })
  );
  for (let attempt = 1; attempt <= 4 && remote && !outcome.paid; attempt += 1) {
    if (!['', 'initiated', 'pending', 'in_progress'].includes(outcome.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    remote = await retrieveTapCharge(input.tapSecretKey, input.tapChargeId);
    outcome = tapChargeOutcome(remote);
    console.info(
      '[payments] tap return',
      JSON.stringify({
        ...formatTapChargeLog(input.tapChargeId, outcome, Boolean(remote)),
        queryStatus: input.returnStatus || null,
        draftId: input.draftId,
        attempt,
      })
    );
  }
  const remoteStatus = outcome.status || null;
  const paidOk = outcome.paid;

  if (!paidOk) {
    return {
      success: false,
      orderId: input.draftId,
      paymentStatus: remoteStatus || String(input.returnStatus || 'pending'),
      orderStatus: 'awaiting_payment',
      startTracking: false,
      testMode,
      message: remoteStatus
        ? `Tap ${remoteStatus}${outcome.responseCode ? ` (${outcome.responseCode}${outcome.responseMessage ? ` ${outcome.responseMessage}` : ''})` : ''}`
        : 'Could not read the Tap charge',
    };
  }

  let paymentDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;
  const paymentsQuery = await db
    .collection('payments')
    .where('transactionId', '==', input.tapChargeId)
    .limit(1)
    .get();

  if (paymentsQuery.empty) {
    const createdRef = db.collection('payments').doc();
    await createdRef.set({
      userId: input.uid,
      draftId: input.draftId,
      orderId: null,
      status: 'authorized',
      transactionId: input.tapChargeId,
      tapChargeId: input.tapChargeId,
      gateway: 'tap',
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

  const draftCandidates = [
    draftIdFromCharge(remote),
    String(payment.draftId || ''),
    input.draftId,
  ];
  let draftId = '';
  for (const candidate of draftCandidates) {
    const owned = await ownedCheckoutDraftId(db, input.uid, candidate);
    if (owned) {
      draftId = owned;
      break;
    }
  }
  if (!draftId) {
    return {
      success: false,
      orderId: input.draftId,
      paymentStatus: remoteStatus || 'captured',
      orderStatus: 'awaiting_payment',
      startTracking: false,
      testMode,
      message: 'Checkout draft not found for this captured charge',
    };
  }
  if (draftId !== input.draftId) {
    console.info(
      '[payments] tap return using charge draft',
      JSON.stringify({ queryDraftId: input.draftId, draftId, chargeId: input.tapChargeId })
    );
  }

  await paymentDoc.ref.set(
    {
      status: 'authorized',
      draftId,
      tapStatus: remoteStatus,
      gateway: 'tap',
      testMode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const finalized = await finalizeOrderFromCheckoutDraft(db, {
    userId: input.uid,
    draftId,
    paymentId: paymentDoc.id,
    tapChargeId: input.tapChargeId,
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

/**
 * Resolve checkout draft from a Tap charge id when the redirect URL did not
 * keep `draftId`.
 */
export async function resolveDraftIdFromTapCharge(
  db: admin.firestore.Firestore,
  uid: string,
  tapChargeId: string
): Promise<string | null> {
  const id = String(tapChargeId || '').trim();
  if (!id) return null;
  const paymentsQuery = await db
    .collection('payments')
    .where('transactionId', '==', id)
    .limit(1)
    .get();
  if (paymentsQuery.empty) return null;
  const payment = paymentsQuery.docs[0].data() as Record<string, unknown>;
  if (payment.userId && payment.userId !== uid) {
    throw Object.assign(new Error('Payment does not belong to authenticated user'), {
      statusCode: 403,
    });
  }
  const draftId = String(payment.draftId || '').trim();
  return draftId || null;
}
