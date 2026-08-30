/**
 * Paid/created order count for the first-N-orders service-fee promo.
 * Excludes unpaid drafts and voided statuses — never trust a client-supplied count.
 */

import admin from 'firebase-admin';
import { canUseAdminFirestore } from './firebaseAdmin.ts';
import { FREE_SERVICE_FEE_ORDERS } from '../../src/domain/financials.ts';

const UNPAID_OR_VOID = new Set([
  'awaiting_payment',
  'draft',
  'quoted',
  'cancelled',
  'expired',
]);

export function isPaidCreatedOrderStatus(status: string | undefined | null): boolean {
  const value = String(status || '').trim();
  if (!value) return false;
  return !UNPAID_OR_VOID.has(value);
}

export async function countPaidCustomerOrders(
  db: admin.firestore.Firestore,
  userId: string
): Promise<number> {
  if (!userId || !canUseAdminFirestore()) return 0;
  try {
    const snap = await db
      .collection('orders')
      .where('userId', '==', userId)
      .limit(100)
      .get();
    let count = 0;
    snap.forEach((row) => {
      if (isPaidCreatedOrderStatus(String(row.data()?.status || ''))) {
        count += 1;
      }
    });
    return count;
  } catch (error) {
    console.warn('[promo] Could not count customer orders:', error);
    return 0;
  }
}

export function remainingFreeServiceFeeOrders(paidCount: number): number {
  return Math.max(0, FREE_SERVICE_FEE_ORDERS - paidCount);
}
