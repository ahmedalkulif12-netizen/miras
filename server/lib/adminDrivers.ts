import admin from 'firebase-admin';
import { isTestOrGhostRecord } from './testDataPatterns.ts';
import { hasCompleteKycDocuments } from './kycDocumentStorage.ts';
import { timestampToIso } from './timestamps.ts';

export type AdminDriverStatus =
  | 'approved'
  | 'pending'
  | 'ready_for_review'
  | 'rejected'
  | 'suspended'
  | 'banned';

export type AdminApplicantKind = 'b2c_driver' | 'fleet_driver';

export interface DriverDocumentMeta {
  status: 'not_uploaded' | 'uploaded';
  expiresAt?: string | null;
  storagePath?: string | null;
  contentType?: string | null;
  fileName?: string | null;
  /** True when a Storage object path exists for admin viewing. */
  viewable?: boolean;
}

export interface AdminDriverRow {
  id: string;
  kind: AdminApplicantKind;
  name: string;
  phone: string;
  truck: string;
  serviceType: string;
  subtype: string;
  plateNumber: string;
  nationalId?: string;
  registrationSerial?: string;
  companyName?: string;
  operatorId?: string;
  vehicleId?: string;
  status: AdminDriverStatus;
  docsComplete: boolean;
  rejectionReason?: string | null;
  complaints: number;
  createdAt?: string | null;
  documents: {
    license: DriverDocumentMeta;
    id: DriverDocumentMeta;
    registration: DriverDocumentMeta;
    permit: DriverDocumentMeta;
  };
}

const ALLOWED_STATUSES = new Set<AdminDriverStatus>([
  'approved',
  'pending',
  'ready_for_review',
  'rejected',
  'suspended',
  'banned',
]);

const DRIVER_ROLES = new Set(['driver', 'b2c_driver']);
const REVIEW_QUEUE_STATUSES = new Set(['pending', 'pending_review', 'ready_for_review']);

export function isDriverUserRole(role: unknown): boolean {
  return DRIVER_ROLES.has(String(role || ''));
}

function mapStatus(raw: unknown, docsComplete: boolean): AdminDriverStatus {
  const value = String(raw || 'pending');
  if (value === 'active') return 'approved';
  if (value === 'blocked') return 'banned';
  if (REVIEW_QUEUE_STATUSES.has(value)) {
    return docsComplete ? 'ready_for_review' : 'pending';
  }
  if (ALLOWED_STATUSES.has(value as AdminDriverStatus)) return value as AdminDriverStatus;
  return docsComplete ? 'ready_for_review' : 'pending';
}

function readDocMeta(
  documents: Record<string, unknown> | undefined,
  key: string,
  expiries: Record<string, unknown> | undefined
): DriverDocumentMeta {
  const raw = documents?.[key];
  const asObj = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : null;
  const status =
    raw === 'uploaded' || asObj?.status === 'uploaded'
      ? 'uploaded'
      : 'not_uploaded';
  const storagePath =
    (asObj?.storagePath != null ? String(asObj.storagePath) : null) ||
    (asObj?.path != null ? String(asObj.path) : null);
  const contentType = asObj?.contentType != null ? String(asObj.contentType) : null;
  const fileName = asObj?.fileName != null ? String(asObj.fileName) : null;
  const expiresAt =
    (asObj?.expiresAt != null ? String(asObj.expiresAt) : null) ||
    (expiries?.[key] != null ? String(expiries[key]) : null) ||
    null;
  return {
    status,
    expiresAt,
    storagePath: storagePath || null,
    contentType,
    fileName,
    viewable: Boolean(storagePath),
  };
}

async function queryDriverUsers(
  db: admin.firestore.Firestore
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const [legacy, modern] = await Promise.all([
    db.collection('users').where('role', '==', 'driver').limit(100).get(),
    db.collection('users').where('role', '==', 'b2c_driver').limit(100).get(),
  ]);
  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  legacy.docs.forEach((d) => byId.set(d.id, d));
  modern.docs.forEach((d) => byId.set(d.id, d));
  return Array.from(byId.values());
}

/** List driver operators from users/{uid} + drivers/{uid} metadata. */
export async function listAdminDrivers(db: admin.firestore.Firestore): Promise<AdminDriverRow[]> {
  const [userDocs, driversSnap, pendingSnap, pendingReviewSnap, readySnap] = await Promise.all([
    queryDriverUsers(db),
    db.collection('drivers').limit(300).get(),
    db.collection('drivers').where('accountStatus', '==', 'pending').limit(100).get(),
    db.collection('drivers').where('accountStatus', '==', 'pending_review').limit(100).get(),
    db.collection('drivers').where('accountStatus', '==', 'ready_for_review').limit(100).get(),
  ]);

  const byId = new Map<string, { user?: Record<string, unknown>; driver?: Record<string, unknown> }>();

  for (const userDoc of userDocs) {
    byId.set(userDoc.id, { user: userDoc.data() as Record<string, unknown> });
  }

  for (const driverDoc of [
    ...driversSnap.docs,
    ...pendingSnap.docs,
    ...pendingReviewSnap.docs,
    ...readySnap.docs,
  ]) {
    const existing = byId.get(driverDoc.id) || {};
    existing.driver = driverDoc.data() as Record<string, unknown>;
    byId.set(driverDoc.id, existing);
  }

  // Attach missing driver companion docs for user-sourced rows.
  await Promise.all(
    Array.from(byId.entries()).map(async ([uid, entry]) => {
      if (entry.driver) return;
      const driverSnap = await db.collection('drivers').doc(uid).get();
      if (driverSnap.exists) {
        entry.driver = driverSnap.data() as Record<string, unknown>;
      }
    })
  );

  const rows: AdminDriverRow[] = [];
  for (const [id, entry] of byId.entries()) {
    const user = entry.user || {};
    const driver = entry.driver || {};
    // Include drivers/{uid} orphans (registration wrote companion before users).
    if (!entry.driver && !isDriverUserRole(user.role)) {
      continue;
    }

    if (
      isTestOrGhostRecord({
        uid: id,
        phone: user.phone || driver.phone,
        name: user.name || driver.fullName || driver.name,
        plateNumber: driver.plateNumber || user.plateNumber,
      })
    ) {
      continue;
    }

    const documents = (driver.documents || {}) as Record<string, unknown>;
    const expiries = (driver.documentExpiries || user.documentExpiries || {}) as Record<
      string,
      unknown
    >;
    const docsComplete = hasCompleteKycDocuments(documents);
    const rejectionReason = driver.rejectionReason
      ? String(driver.rejectionReason)
      : user.rejectionReason
        ? String(user.rejectionReason)
        : null;

    rows.push({
      id,
      kind: 'b2c_driver',
      name: String(user.name || driver.fullName || driver.name || 'Driver'),
      phone: String(user.phone || driver.phone || ''),
      truck: String(driver.vehicleType || user.vehicleType || '—'),
      serviceType: String(driver.serviceType || user.vehicleType || 'flatbed'),
      subtype: String(driver.vehicleSize || driver.vehicleOption || user.vehicleOption || ''),
      plateNumber: String(driver.plateNumber || user.plateNumber || '—'),
      nationalId: driver.nationalId
        ? String(driver.nationalId)
        : user.nationalId
          ? String(user.nationalId)
          : undefined,
      registrationSerial: driver.registrationSerial
        ? String(driver.registrationSerial)
        : undefined,
      status: mapStatus(driver.accountStatus ?? user.accountStatus ?? 'pending', docsComplete),
      docsComplete,
      rejectionReason,
      complaints: Number(driver.complaints ?? 0) || 0,
      createdAt: timestampToIso(
        driver.submittedAt || driver.createdAt || driver.updatedAt || user.createdAt
      ),
      documents: {
        license: readDocMeta(documents, 'license', expiries),
        id: readDocMeta(documents, 'id', expiries),
        registration: readDocMeta(documents, 'registration', expiries),
        permit: readDocMeta(documents, 'permit', expiries),
      },
    });
  }

  const operatorsSnap = await db.collection('operators').limit(200).get();
  await Promise.all(
    operatorsSnap.docs.map(async (operatorDoc) => {
      const operator = operatorDoc.data() as Record<string, unknown>;
      const vehiclesSnap = await db
        .collection('operators')
        .doc(operatorDoc.id)
        .collection('vehicles')
        .limit(200)
        .get();
      for (const vehicleDoc of vehiclesSnap.docs) {
        const vehicle = vehicleDoc.data() as Record<string, unknown>;
        const driverName = String(vehicle.driverName || '').trim();
        const plate = String(vehicle.plateNumber || '');
        if (
          isTestOrGhostRecord({
            uid: vehicleDoc.id,
            name: driverName,
            plateNumber: plate,
            companyName: operator.companyName || operator.contactName,
          })
        ) {
          continue;
        }
        if (!driverName && !plate) continue;

        const documents = (vehicle.documents || {}) as Record<string, unknown>;
        const docsComplete = hasCompleteKycDocuments(documents);
        rows.push({
          id: `fleet:${operatorDoc.id}:${vehicleDoc.id}`,
          kind: 'fleet_driver',
          name: driverName || plate || 'Fleet driver',
          phone: String(vehicle.phone || operator.phone || ''),
          truck: String(vehicle.type || vehicle.serviceType || vehicle.category || '—'),
          serviceType: String(vehicle.serviceType || vehicle.category || ''),
          subtype: String(vehicle.serviceOption || vehicle.subtype || ''),
          plateNumber: plate || '—',
          companyName: String(operator.companyName || operator.contactName || operator.name || ''),
          operatorId: operatorDoc.id,
          vehicleId: vehicleDoc.id,
          status: mapStatus(vehicle.accountStatus || 'pending', docsComplete),
          docsComplete,
          rejectionReason: vehicle.rejectionReason ? String(vehicle.rejectionReason) : null,
          complaints: 0,
          createdAt: timestampToIso(vehicle.createdAt || vehicle.updatedAt || operator.createdAt),
          documents: {
            license: readDocMeta(documents, 'license', {}),
            id: readDocMeta(documents, 'id', {}),
            registration: readDocMeta(documents, 'registration', {}),
            permit: readDocMeta(documents, 'permit', {}),
          },
        });
      }
    })
  );

  // Ready-for-review applications first so admins see the pre-filtered inbox immediately.
  rows.sort((a, b) => {
    if (a.status === 'ready_for_review' && b.status !== 'ready_for_review') return -1;
    if (b.status === 'ready_for_review' && a.status !== 'ready_for_review') return 1;
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Update driver moderation status on both drivers/{uid} and users/{uid}
 * so accept-order gates and admin UI stay in sync.
 */
export async function updateAdminDriverStatus(
  db: admin.firestore.Firestore,
  uid: string,
  status: AdminDriverStatus,
  adminUid: string,
  opts?: { reason?: string }
): Promise<void> {
  if (!ALLOWED_STATUSES.has(status) || status === 'pending' || status === 'ready_for_review') {
    throw Object.assign(new Error('Invalid driver status'), { statusCode: 400 });
  }

  const reason = String(opts?.reason || '').trim();
  if (status === 'rejected' && reason.length < 3) {
    throw Object.assign(new Error('Rejection reason is required'), { statusCode: 400 });
  }

  const userRef = db.collection('users').doc(uid);
  const driverRef = db.collection('drivers').doc(uid);
  const [userSnap, driverSnap] = await Promise.all([userRef.get(), driverRef.get()]);

  if (!userSnap.exists && !driverSnap.exists) {
    throw Object.assign(new Error('Driver not found'), { statusCode: 404 });
  }

  if (userSnap.exists && !isDriverUserRole(userSnap.data()?.role) && !driverSnap.exists) {
    throw Object.assign(new Error('Driver not found'), { statusCode: 404 });
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    accountStatus: status,
    updatedAt: now,
    updatedBy: adminUid,
  };
  if (status === 'rejected') {
    payload.rejectionReason = reason;
    payload.rejectedAt = now;
    payload.rejectedBy = adminUid;
  } else if (status === 'approved') {
    payload.rejectionReason = admin.firestore.FieldValue.delete();
    payload.approvedAt = now;
    payload.approvedBy = adminUid;
  }

  const batch = db.batch();
  batch.set(
    driverRef,
    {
      uid,
      role: 'b2c_driver',
      ...payload,
    },
    { merge: true }
  );
  batch.set(
    userRef,
    {
      uid,
      role: userSnap.exists ? userSnap.data()?.role || 'b2c_driver' : 'b2c_driver',
      ...payload,
    },
    { merge: true }
  );
  await batch.commit();
}

export async function updateAdminFleetVehicleStatus(
  db: admin.firestore.Firestore,
  operatorId: string,
  vehicleId: string,
  status: AdminDriverStatus,
  adminUid: string,
  opts?: { reason?: string }
): Promise<void> {
  if (!ALLOWED_STATUSES.has(status) || status === 'pending' || status === 'ready_for_review') {
    throw Object.assign(new Error('Invalid fleet driver status'), { statusCode: 400 });
  }

  const reason = String(opts?.reason || '').trim();
  if (status === 'rejected' && reason.length < 3) {
    throw Object.assign(new Error('Rejection reason is required'), { statusCode: 400 });
  }

  const vehicleRef = db.collection('operators').doc(operatorId).collection('vehicles').doc(vehicleId);
  const vehicleSnap = await vehicleRef.get();
  if (!vehicleSnap.exists) {
    throw Object.assign(new Error('Fleet vehicle not found'), { statusCode: 404 });
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    accountStatus: status,
    updatedAt: now,
    updatedBy: adminUid,
  };
  if (status === 'rejected') {
    payload.rejectionReason = reason;
    payload.rejectedAt = now;
    payload.rejectedBy = adminUid;
  } else if (status === 'approved') {
    payload.rejectionReason = admin.firestore.FieldValue.delete();
    payload.approvedAt = now;
    payload.approvedBy = adminUid;
  }

  await vehicleRef.set(payload, { merge: true });
}

export async function updateAdminDriverDocumentExpiries(
  db: admin.firestore.Firestore,
  uid: string,
  documentExpiries: Record<string, string>,
  adminUid: string
): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists || !isDriverUserRole(userSnap.data()?.role)) {
    throw Object.assign(new Error('Driver not found'), { statusCode: 404 });
  }

  const cleaned: Record<string, string> = {};
  for (const key of ['license', 'id', 'registration', 'permit'] as const) {
    const value = documentExpiries[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      cleaned[key] = value;
    }
  }

  await db.collection('drivers').doc(uid).set(
    {
      uid,
      documentExpiries: cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    },
    { merge: true }
  );
}
