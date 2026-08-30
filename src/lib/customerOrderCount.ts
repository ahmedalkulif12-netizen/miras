import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { FREE_SERVICE_FEE_ORDERS, shouldWaiveServiceFee } from '@/domain/financials';

const UNPAID_OR_VOID = new Set([
  'awaiting_payment',
  'draft',
  'quoted',
  'cancelled',
  'expired',
]);

export { FREE_SERVICE_FEE_ORDERS, shouldWaiveServiceFee };

/** Paid/created orders that consume the first-3-orders promo. */
export function isPaidCreatedOrderStatus(status: string | undefined | null): boolean {
  const value = String(status || '').trim();
  if (!value) return false;
  return !UNPAID_OR_VOID.has(value);
}

export async function countCustomerPaidOrders(uid: string): Promise<number> {
  if (!uid) return 0;
  await ensureFirebaseReady();
  try {
    const snap = await getDocs(
      query(collection(db, 'orders'), where('userId', '==', uid), limit(100))
    );
    let count = 0;
    snap.forEach((row) => {
      if (isPaidCreatedOrderStatus(String(row.data().status || ''))) {
        count += 1;
      }
    });
    return count;
  } catch (error) {
    console.warn('[promo] Could not count customer orders:', error);
    return 0;
  }
}
