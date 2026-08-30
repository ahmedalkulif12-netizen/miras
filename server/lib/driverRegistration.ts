import admin from 'firebase-admin';
import { missingKycDocumentKeys } from './kycDocumentStorage.ts';

export interface DriverRegistrationPayload {
  name?: string;
  phone?: string;
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  nationalId?: string;
  registrationSerial?: string;
  documentUploadStatuses?: Record<string, string>;
  documentExpiries?: Record<string, string>;
  documentFiles?: Record<
    string,
    {
      status?: string;
      storagePath?: string;
      url?: string;
      contentType?: string;
      fileName?: string;
      uploadedAt?: string;
    }
  >;
}

/**
 * Upsert a pending driver application via Admin SDK so admin list/overview
 * always see new registrations even when client Firestore rules soft-fail.
 */
export async function upsertPendingDriverRegistration(
  db: admin.firestore.Firestore,
  uid: string,
  payload: DriverRegistrationPayload
): Promise<{ uid: string; accountStatus: 'pending' | string; created: boolean }> {
  const userRef = db.collection('users').doc(uid);
  const driverRef = db.collection('drivers').doc(uid);
  const [userSnap, driverSnap] = await Promise.all([userRef.get(), driverRef.get()]);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const existingDriverStatus = driverSnap.exists
    ? String(driverSnap.data()?.accountStatus || '')
    : '';
  const existingUserStatus = userSnap.exists ? String(userSnap.data()?.accountStatus || '') : '';

  // Never downgrade an already-moderated account back to review.
  const preserveStatus =
    existingDriverStatus &&
    !['pending', 'pending_review', 'ready_for_review', ''].includes(existingDriverStatus)
      ? existingDriverStatus
      : existingUserStatus &&
          !['pending', 'pending_review', 'ready_for_review', 'active', ''].includes(
            existingUserStatus
          )
        ? existingUserStatus
        : null;

  const documents: Record<string, unknown> = {};
  const keys = ['license', 'id', 'registration', 'permit'] as const;
  for (const key of keys) {
    const file = payload.documentFiles?.[key];
    if (file?.storagePath) {
      documents[key] = {
        status: 'uploaded',
        storagePath: file.storagePath,
        url: file.url || null,
        contentType: file.contentType || null,
        fileName: file.fileName || null,
        uploadedAt: file.uploadedAt || null,
      };
    } else if (payload.documentUploadStatuses?.[key] === 'uploaded') {
      const existing =
        ((driverSnap.data()?.documents || {}) as Record<string, unknown>)[key] ||
        ((userSnap.data()?.documents || {}) as Record<string, unknown>)[key];
      if (existing && typeof existing === 'object') {
        documents[key] = existing;
      }
    }
  }

  const missingDocs = missingKycDocumentKeys(documents);
  if (missingDocs.length > 0) {
    throw Object.assign(
      new Error(`Missing: ${missingDocs.join(', ')}`),
      { statusCode: 400, missingDocs, code: 'DOCUMENTS_INCOMPLETE' }
    );
  }

  const accountStatus = preserveStatus || 'ready_for_review';
  const created = !driverSnap.exists;
  const documentExpiries = payload.documentExpiries || {};

  const batch = db.batch();

  batch.set(
    userRef,
    {
      uid,
      phone: payload.phone || userSnap.data()?.phone || '',
      role: 'b2c_driver',
      name: payload.name || userSnap.data()?.name || `Driver_${uid.slice(0, 4)}`,
      ...(payload.vehicleType ? { vehicleType: payload.vehicleType } : {}),
      ...(payload.vehicleOption ? { vehicleOption: payload.vehicleOption } : {}),
      ...(payload.plateNumber ? { plateNumber: payload.plateNumber } : {}),
      ...(payload.nationalId ? { nationalId: payload.nationalId } : {}),
      ...(payload.registrationSerial
        ? { registrationSerial: payload.registrationSerial }
        : {}),
      accountStatus,
      ...(Object.keys(documents).length ? { documents } : {}),
      ...(userSnap.exists ? {} : { createdAt: now }),
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    driverRef,
    {
      uid,
      fullName: payload.name || driverSnap.data()?.fullName || `Driver_${uid.slice(0, 4)}`,
      phone: payload.phone || driverSnap.data()?.phone || '',
      role: 'b2c_driver',
      vehicleType: payload.vehicleType || driverSnap.data()?.vehicleType || '',
      vehicleSize: payload.vehicleOption || driverSnap.data()?.vehicleSize || '',
      plateNumber: payload.plateNumber || driverSnap.data()?.plateNumber || '',
      ...(payload.nationalId ? { nationalId: payload.nationalId } : {}),
      ...(payload.registrationSerial
        ? { registrationSerial: payload.registrationSerial }
        : {}),
      ...(Object.keys(documents).length ? { documents } : {}),
      ...(Object.keys(documentExpiries).length ? { documentExpiries } : {}),
      accountStatus,
      ...(driverSnap.exists ? {} : { createdAt: now }),
      updatedAt: now,
      submittedAt: created ? now : driverSnap.data()?.submittedAt || now,
    },
    { merge: true }
  );

  await batch.commit();
  return { uid, accountStatus, created };
}
