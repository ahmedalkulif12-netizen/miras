import admin from 'firebase-admin';
import { isTestOrGhostRecord } from './testDataPatterns.ts';

export type AdminCustomerStatus = 'active' | 'blocked' | 'banned' | 'pending' | 'suspended';

export interface AdminCustomerRow {
  id: string;
  name: string;
  phone: string;
  status: AdminCustomerStatus;
  ordersCount: number;
  totalSpentSar: number;
}

const ALLOWED = new Set<AdminCustomerStatus>([
  'active',
  'blocked',
  'banned',
  'pending',
  'suspended',
]);

const CLIENT_ROLES = new Set(['customer', 'b2c_client']);

export function isClientUserRole(role: unknown): boolean {
  return CLIENT_ROLES.has(String(role || ''));
}

function mapStatus(raw: unknown): AdminCustomerStatus {
  const value = String(raw || 'active');
  if (value === 'deleted') return 'banned';
  if (ALLOWED.has(value as AdminCustomerStatus)) return value as AdminCustomerStatus;
  return 'active';
}

async function queryClientUsers(
  db: admin.firestore.Firestore
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const [legacy, modern] = await Promise.all([
    db.collection('users').where('role', '==', 'customer').limit(100).get(),
    db.collection('users').where('role', '==', 'b2c_client').limit(100).get(),
  ]);
  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  legacy.docs.forEach((d) => byId.set(d.id, d));
  modern.docs.forEach((d) => byId.set(d.id, d));
  return Array.from(byId.values());
}

export async function listAdminCustomers(
  db: admin.firestore.Firestore
): Promise<AdminCustomerRow[]> {
  const userDocs = await queryClientUsers(db);

  const rows = await Promise.all(
    userDocs.map(async (userDoc) => {
      const user = userDoc.data() as Record<string, unknown>;
      const customerSnap = await db.collection('customers').doc(userDoc.id).get();
      const customer = customerSnap.data() as Record<string, unknown> | undefined;

      if (
        isTestOrGhostRecord({
          uid: userDoc.id,
          phone: user.phone || customer?.phone,
          name: customer?.fullName || user.name,
        })
      ) {
        return null;
      }

      const ordersSnap = await db
        .collection('orders')
        .where('userId', '==', userDoc.id)
        .limit(50)
        .get();

      let totalSpentSar = 0;
      ordersSnap.docs.forEach((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const financials = data.financials as Record<string, unknown> | undefined;
        totalSpentSar +=
          Number(financials?.customerTotal ?? data.totalPrice ?? data.price ?? 0) || 0;
      });

      return {
        id: userDoc.id,
        name: String(customer?.fullName || user.name || 'Client'),
        phone: String(user.phone || customer?.phone || ''),
        status: mapStatus(customer?.accountStatus ?? user.accountStatus),
        ordersCount: ordersSnap.size,
        totalSpentSar: Math.round(totalSpentSar),
      } satisfies AdminCustomerRow;
    })
  );

  return rows.filter((row): row is AdminCustomerRow => row !== null);
}

export async function updateAdminCustomerStatus(
  db: admin.firestore.Firestore,
  uid: string,
  status: AdminCustomerStatus,
  adminUid: string
): Promise<void> {
  if (!ALLOWED.has(status)) {
    throw Object.assign(new Error('Invalid customer status'), { statusCode: 400 });
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists || !isClientUserRole(userSnap.data()?.role)) {
    throw Object.assign(new Error('Client not found'), { statusCode: 404 });
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    accountStatus: status,
    updatedAt: now,
    updatedBy: adminUid,
  };

  const batch = db.batch();
  batch.set(db.collection('customers').doc(uid), { uid, ...payload }, { merge: true });
  batch.set(userRef, payload, { merge: true });
  await batch.commit();
}

/** Gate order creation — blocked/banned clients cannot book. */
export async function assertCustomerCanBook(
  db: admin.firestore.Firestore,
  uid: string
): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw Object.assign(new Error('User profile not found'), { statusCode: 404 });
  }

  const user = userSnap.data() as Record<string, unknown>;
  const customerSnap = await db.collection('customers').doc(uid).get();
  const status = String(
    customerSnap.data()?.accountStatus ?? user.accountStatus ?? 'active'
  );

  if (status === 'blocked' || status === 'banned' || status === 'suspended') {
    throw Object.assign(new Error('This account is blocked from creating orders'), {
      statusCode: 403,
    });
  }
}
