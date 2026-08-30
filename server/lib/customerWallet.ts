/**
 * Customer wallet debit on place-order (Admin SDK).
 * Client rules keep wallets/{id} write-locked — never debit from the browser.
 */

import admin from 'firebase-admin';
import { canUseAdminFirestore } from './firebaseAdmin.ts';

const DUMMY_STARTING_BALANCE = 1420.5;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function seedDummyBalance(): boolean {
  if (process.env.K_SERVICE) return false;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

/**
 * Idempotent debit of customerTotal after a paid order is written.
 */
export async function debitCustomerWalletOnOrder(
  db: admin.firestore.Firestore,
  params: { userId: string; orderId: string; amount: number }
): Promise<void> {
  if (!canUseAdminFirestore()) return;
  const userId = String(params.userId || '').trim();
  const orderId = String(params.orderId || '').trim();
  const debit = roundMoney(Math.max(0, Number(params.amount) || 0));
  if (!userId || !orderId || debit <= 0) return;

  const ref = db.collection('wallets').doc(userId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.data() || {}) as Record<string, unknown>;
      const deducted = Array.isArray(data.deductedOrderIds)
        ? data.deductedOrderIds.map(String)
        : [];
      if (deducted.includes(orderId)) return;

      let balance = Number(data.balance);
      if (!Number.isFinite(balance)) {
        balance = seedDummyBalance() ? DUMMY_STARTING_BALANCE : 0;
      }

      const existingTxs = Array.isArray(data.transactions) ? data.transactions : [];
      const payId = `pay_${orderId}`;
      const hasPayTx = existingTxs.some(
        (row) => row && typeof row === 'object' && String((row as { id?: unknown }).id) === payId
      );
      const nowIso = new Date().toISOString();
      const transactions = hasPayTx
        ? existingTxs
        : [
            {
              id: payId,
              type: 'payment',
              orderId,
              amount: debit,
              isDebit: true,
              createdAt: nowIso,
            },
            ...existingTxs,
          ].slice(0, 200);

      tx.set(
        ref,
        {
          ownerId: userId,
          ownerRole: data.ownerRole || 'customer',
          currency: 'SAR',
          balance: roundMoney(Math.max(0, balance - debit)),
          deductedOrderIds: [...deducted, orderId].slice(-200),
          lastDebitAmount: debit,
          lastDebitOrderId: orderId,
          lastDebitAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          transactions,
        },
        { merge: true }
      );
    });
    console.info('[wallet] Debited customer wallet', { userId, orderId, amount: debit });
  } catch (error) {
    console.warn('[wallet] Customer debit failed:', error);
  }
}
