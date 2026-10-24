import admin from 'firebase-admin';
import {
  normalizePayoutBank,
  validateCompanyCompliance,
  type PayoutBankAccount,
} from '../../src/domain/accountProfiles.ts';

export interface OperatorRegistrationPayload {
  companyName?: string;
  contactName?: string;
  phone?: string;
  commercialRegistration?: string;
  bankDetails?: Partial<PayoutBankAccount>;
  crDocument?: {
    storagePath?: string;
    url?: string;
    contentType?: string;
    fileName?: string;
    uploadedAt?: string;
  };
}

export async function upsertOperatorRegistration(
  db: admin.firestore.Firestore,
  uid: string,
  payload: OperatorRegistrationPayload
): Promise<{ uid: string; accountStatus: string }> {
  const userRef = db.collection('users').doc(uid);
  const operatorRef = db.collection('operators').doc(uid);
  const [userSnap, operatorSnap] = await Promise.all([userRef.get(), operatorRef.get()]);
  const existing = (operatorSnap.data() || {}) as Record<string, unknown>;
  const companyName = String(payload.companyName || existing.companyName || '').trim();
  const commercialRegistration = String(
    payload.commercialRegistration || existing.commercialRegistration || ''
  ).replace(/\D/g, '');
  const bankInput =
    payload.bankDetails || (existing.bankDetails as Partial<PayoutBankAccount> | undefined);
  const code = validateCompanyCompliance({
    companyName,
    commercialRegistration,
    bank: bankInput || {},
  });
  if (code) {
    throw Object.assign(new Error(code), { statusCode: 400, code });
  }
  const cr = payload.crDocument;
  const existingCr = (existing.documents as Record<string, unknown> | undefined)?.cr;
  if (!cr?.storagePath && !(existingCr && typeof existingCr === 'object')) {
    throw Object.assign(new Error('CR_DOCUMENT_REQUIRED'), {
      statusCode: 400,
      code: 'CR_DOCUMENT_REQUIRED',
    });
  }
  const bankDetails = normalizePayoutBank(bankInput || {}, { requireTransferId: false });
  const now = admin.firestore.FieldValue.serverTimestamp();
  const accountStatus = String(existing.accountStatus || 'pending');
  const batch = db.batch();
  batch.set(
    userRef,
    {
      uid,
      role: userSnap.exists ? userSnap.data()?.role || 'b2b_operator' : 'b2b_operator',
      name: payload.contactName || userSnap.data()?.name || companyName,
      phone: payload.phone || userSnap.data()?.phone || '',
      companyName,
      commercialRegistration,
      bankDetails,
      ...(userSnap.exists ? {} : { accountStatus: 'active', createdAt: now }),
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    operatorRef,
    {
      uid,
      role: 'b2b_operator',
      companyName,
      contactName: payload.contactName || existing.contactName || companyName,
      phone: payload.phone || existing.phone || '',
      commercialRegistration,
      bankDetails,
      ...(cr?.storagePath
        ? {
            documents: {
              ...((existing.documents as Record<string, unknown> | undefined) || {}),
              cr: {
                status: 'uploaded',
                storagePath: cr.storagePath,
                url: cr.url || null,
                contentType: cr.contentType || null,
                fileName: cr.fileName || null,
                uploadedAt: cr.uploadedAt || null,
              },
            },
          }
        : {}),
      accountStatus,
      ...(operatorSnap.exists ? {} : { createdAt: now }),
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();
  return { uid, accountStatus };
}
