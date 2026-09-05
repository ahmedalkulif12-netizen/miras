import admin from 'firebase-admin';
import { canUseAdminFirestore } from './firebaseAdmin.ts';

export interface CustomerOrderListItem {
  id: string;
  data: Record<string, unknown>;
}

function toPlain(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
      try {
        out[key] = (value as { toDate: () => Date }).toDate().toISOString();
      } catch {
        /* keep original */
      }
    }
  }
  return out;
}

function createdMs(data: Record<string, unknown>): number {
  const raw = data.createdAt ?? data.promotedAt ?? data.updatedAt;
  if (!raw) return 0;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof raw === 'number') return raw;
  if (typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (raw as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Admin-SDK list of the authenticated customer's orders (userId / clientId / customerId).
 */
export async function listOrdersForCustomer(
  db: admin.firestore.Firestore,
  userId: string
): Promise<CustomerOrderListItem[]> {
  if (!userId || !canUseAdminFirestore()) return [];

  const fields = ['userId', 'clientId', 'customerId'] as const;
  const snaps = await Promise.all(
    fields.map((field) =>
      db.collection('orders').where(field, '==', userId).limit(50).get()
    )
  );

  const byId = new Map<string, Record<string, unknown>>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (!byId.has(doc.id)) {
        byId.set(doc.id, toPlain(doc.data()));
      }
    }
  }

  return Array.from(byId.entries())
    .map(([id, data]) => ({ id, data }))
    .sort((a, b) => createdMs(b.data) - createdMs(a.data))
    .slice(0, 50);
}
