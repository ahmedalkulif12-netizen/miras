import admin from 'firebase-admin';
import { splitTapCharge } from '../../src/domain/tapSplit.ts';
import { resolvePayoutAccount } from '../../src/domain/accountProfiles.ts';
import { getServerConfig } from '../config/env.ts';
import { isPaidTapStatus, retrieveTapCharge } from './tapPayments.ts';
import { captureTapChargeWithDestinations, createTapTransfer } from './tapDestinations.ts';

export interface TapSplitApplyResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  destinationId?: string | null;
  payeeAmount?: number;
  platformAmount?: number;
  payoutKind?: 'individual' | 'company';
  error?: string | null;
}

function str(value: unknown): string {
  return String(value || '').trim();
}

async function loadPayment(
  db: admin.firestore.Firestore,
  orderId: string,
  order: Record<string, unknown>
): Promise<admin.firestore.DocumentSnapshot | null> {
  const paymentId = str(order.paymentId);
  if (paymentId) {
    const snap = await db.collection('payments').doc(paymentId).get();
    if (snap.exists) return snap;
  }
  const query = await db.collection('payments').where('orderId', '==', orderId).limit(1).get();
  return query.docs[0] || null;
}

async function resolveDestination(
  db: admin.firestore.Firestore,
  driverId: string
): Promise<{
  destinationId: string;
  payoutKind: 'individual' | 'company';
  ownerId: string;
} | null> {
  const driverSnap = await db.collection('drivers').doc(driverId).get();
  const driver = (driverSnap.data() || {}) as Record<string, unknown>;
  const payout = resolvePayoutAccount({
    driverId,
    operatorId: str(driver.operatorId || driver.companyId),
  });
  if (payout.kind === 'company') {
    const operatorSnap = await db.collection('operators').doc(payout.ownerId).get();
    const destinationId = str(operatorSnap.data()?.tapDestinationId);
    if (!destinationId) return null;
    return { destinationId, payoutKind: 'company', ownerId: payout.ownerId };
  }
  const destinationId = str(driver.tapDestinationId);
  if (!destinationId) return null;
  return { destinationId, payoutKind: 'individual', ownerId: driverId };
}

/**
 * Route the payee share to the driver or company destination.
 * Authorized charges are captured with destinations. Already-captured charges
 * use a Tap transfer. Safe to call twice.
 */
export async function applyTapSplitForOrder(
  db: admin.firestore.Firestore,
  orderId: string,
  driverId: string
): Promise<TapSplitApplyResult> {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { ok: false, skipped: true, reason: 'ORDER_NOT_FOUND' };
  const order = orderSnap.data() as Record<string, unknown>;
  const paymentSnap = await loadPayment(db, orderId, order);
  if (!paymentSnap) return { ok: false, skipped: true, reason: 'PAYMENT_NOT_FOUND' };
  const payment = paymentSnap.data() as Record<string, unknown>;
  if (payment.splitStatus === 'applied') {
    return { ok: true, skipped: true, reason: 'ALREADY_APPLIED' };
  }

  const destination = await resolveDestination(db, driverId);
  const financials = (order.financials || payment.financials || null) as {
    customerTotal?: number;
    driverNet?: number;
    tripFare?: number;
  } | null;
  const chargeAmount = Number(payment.amount || financials?.customerTotal || 0);
  const split = splitTapCharge(chargeAmount, financials);
  if (!destination) {
    await paymentSnap.ref.set(
      {
        splitStatus: 'destination_missing',
        split,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, skipped: true, reason: 'DESTINATION_MISSING', ...split };
  }
  if (split.payeeAmount <= 0) {
    return { ok: false, skipped: true, reason: 'NOTHING_TO_PAY', ...split };
  }

  const secret = getServerConfig().tapSecretKey;
  if (!secret) return { ok: false, skipped: true, reason: 'TAP_NOT_CONFIGURED', ...split };

  const chargeId = str(payment.tapChargeId || payment.transactionId);
  if (!chargeId) return { ok: false, skipped: true, reason: 'CHARGE_ID_MISSING', ...split };

  try {
    const charge = await retrieveTapCharge(secret, chargeId);
    const status = str(charge?.status).toLowerCase();
    let mode: 'capture' | 'transfer' = 'transfer';
    let tapId = '';
    if (status === 'authorized') {
      mode = 'capture';
      const captured = await captureTapChargeWithDestinations(secret, chargeId, {
        amount: split.chargeAmount,
        destinationId: destination.destinationId,
        payeeAmount: split.payeeAmount,
      });
      tapId = str(captured.id || chargeId);
    } else if (isPaidTapStatus(status) || status === 'captured') {
      const transfer = await createTapTransfer(secret, {
        amount: split.payeeAmount,
        destinationId: destination.destinationId,
        orderId,
        chargeId,
      });
      tapId = str(transfer.id);
    } else {
      await paymentSnap.ref.set(
        {
          splitStatus: 'waiting_charge',
          split,
          tapChargeStatus: status || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: false, skipped: true, reason: 'CHARGE_NOT_READY', ...split };
    }

    await paymentSnap.ref.set(
      {
        splitStatus: 'applied',
        splitMode: mode,
        split,
        payoutKind: destination.payoutKind,
        payoutOwnerId: destination.ownerId,
        tapDestinationId: destination.destinationId,
        tapSplitId: tapId || null,
        splitAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('orders').doc(orderId).set(
      {
        payoutKind: destination.payoutKind,
        payoutOwnerId: destination.ownerId,
        tapDestinationId: destination.destinationId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      ok: true,
      destinationId: destination.destinationId,
      payoutKind: destination.payoutKind,
      payeeAmount: split.payeeAmount,
      platformAmount: split.platformAmount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TAP_SPLIT_FAILED';
    console.error('[payments] tap split failed', { orderId, code: (error as { statusCode?: number }).statusCode, message });
    await paymentSnap.ref.set(
      {
        splitStatus: 'failed',
        splitError: message,
        split,
        tapDestinationId: destination.destinationId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, error: message, ...split, destinationId: destination.destinationId };
  }
}
