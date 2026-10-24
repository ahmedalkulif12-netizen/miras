import admin from 'firebase-admin';
import { KYC_DOC_KEYS, missingKycDocumentKeys } from './kycDocumentStorage.ts';
import {
  normalizePayoutBank,
  resolvePlateParts,
  validateIndividualCompliance,
  type PayoutBankAccount,
} from '../../src/domain/accountProfiles.ts';

export const DRIVER_REVIEW_SLA_HOURS = 24;

export interface DriverRegistrationPayload {
  name?: string;
  phone?: string;
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  nationalId?: string;
  registrationSerial?: string;
  dateOfBirth?: string;
  licenseNumber?: string;
  plateLetterRight?: string;
  plateLetterMiddle?: string;
  plateLetterLeft?: string;
  operatingCardNumber?: string;
  bankDetails?: Partial<PayoutBankAccount>;
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
): Promise<{ uid: string; accountStatus: 'pending_approval' | string; created: boolean }> {
  const userRef = db.collection('users').doc(uid);
  const driverRef = db.collection('drivers').doc(uid);
  const [userSnap, driverSnap] = await Promise.all([userRef.get(), driverRef.get()]);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const existingDriverStatus = driverSnap.exists
    ? String(driverSnap.data()?.accountStatus || '')
    : '';
  const existingUserStatus = userSnap.exists ? String(userSnap.data()?.accountStatus || '') : '';

  // Never downgrade an already-moderated account back to review.
  const driverOpenReview = [
    '',
    'pending',
    'pending_approval',
    'pending_review',
    'ready_for_review',
  ];
  const userOpenReview = [...driverOpenReview, 'active'];
  const preserveStatus =
    existingDriverStatus && !driverOpenReview.includes(existingDriverStatus)
      ? existingDriverStatus
      : existingUserStatus && !userOpenReview.includes(existingUserStatus)
        ? existingUserStatus
        : null;

  const documents: Record<string, unknown> = {};
  for (const key of KYC_DOC_KEYS) {
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

  const created = !driverSnap.exists;
  const plate = resolvePlateParts({
    plateNumber: payload.plateNumber || String(driverSnap.data()?.plateNumber || ''),
    plateLetterRight: payload.plateLetterRight,
    plateLetterMiddle: payload.plateLetterMiddle,
    plateLetterLeft: payload.plateLetterLeft,
  });
  const operatingCardExpiry = String(
    payload.documentExpiries?.permit || driverSnap.data()?.documentExpiries?.permit || ''
  );
  if (created || payload.bankDetails || payload.dateOfBirth || payload.licenseNumber) {
    const complianceError = validateIndividualCompliance({
      dateOfBirth: payload.dateOfBirth || String(driverSnap.data()?.dateOfBirth || ''),
      licenseNumber: payload.licenseNumber || String(driverSnap.data()?.licenseNumber || ''),
      plateNumber: payload.plateNumber || String(driverSnap.data()?.plateNumber || ''),
      plateLetterRight: payload.plateLetterRight || plate?.plateLetterRight,
      plateLetterMiddle: payload.plateLetterMiddle || plate?.plateLetterMiddle,
      plateLetterLeft: payload.plateLetterLeft || plate?.plateLetterLeft,
      operatingCardNumber:
        payload.operatingCardNumber || String(driverSnap.data()?.operatingCardNumber || ''),
      operatingCardExpiry,
      bank: payload.bankDetails || (driverSnap.data()?.bankDetails as Partial<PayoutBankAccount>) || {},
    });
    if (created && complianceError) {
      throw Object.assign(new Error(complianceError), {
        statusCode: 400,
        code: complianceError,
      });
    }
  }
  const bankDetails = payload.bankDetails
    ? normalizePayoutBank(payload.bankDetails, { requireTransferId: true })
    : null;

  const accountStatus = preserveStatus || 'pending_approval';
  const documentExpiries: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.documentExpiries || {})) {
    if (typeof value === 'string' && value.trim()) documentExpiries[key] = value.trim();
  }
  const reviewDueAt = new Date(
    Date.now() + DRIVER_REVIEW_SLA_HOURS * 60 * 60 * 1000
  ).toISOString();

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
      ...(payload.dateOfBirth ? { dateOfBirth: payload.dateOfBirth } : {}),
      ...(payload.licenseNumber ? { licenseNumber: payload.licenseNumber } : {}),
      ...(payload.operatingCardNumber
        ? { operatingCardNumber: payload.operatingCardNumber }
        : {}),
      ...(bankDetails ? { bankDetails } : {}),
      accountStatus,
      reviewSlaHours: DRIVER_REVIEW_SLA_HOURS,
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
        ? {
            registrationSerial: payload.registrationSerial,
            vehicleSequenceNumber: payload.registrationSerial,
          }
        : {}),
      ...(payload.dateOfBirth ? { dateOfBirth: payload.dateOfBirth } : {}),
      ...(payload.licenseNumber ? { licenseNumber: payload.licenseNumber } : {}),
      ...(plate
        ? {
            plateDigits: plate.plateDigits,
            plateLetterRight: plate.plateLetterRight,
            plateLetterMiddle: plate.plateLetterMiddle,
            plateLetterLeft: plate.plateLetterLeft,
          }
        : {}),
      ...(payload.operatingCardNumber
        ? { operatingCardNumber: payload.operatingCardNumber }
        : {}),
      ...(bankDetails ? { bankDetails } : {}),
      ...(created ? { payoutAccountKind: 'individual' as const } : {}),
      ...(Object.keys(documents).length ? { documents } : {}),
      ...(Object.keys(documentExpiries).length ? { documentExpiries } : {}),
      accountStatus,
      reviewSlaHours: DRIVER_REVIEW_SLA_HOURS,
      reviewDueAt,
      ...(driverSnap.exists ? {} : { createdAt: now }),
      updatedAt: now,
      submittedAt: created ? now : driverSnap.data()?.submittedAt || now,
    },
    { merge: true }
  );

  await batch.commit();
  return { uid, accountStatus, created };
}
