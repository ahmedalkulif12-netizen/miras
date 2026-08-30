/**
 * Client Firestore access for corporate_contracts/{id}.
 * Corporates create/list own docs; admins list all and approve/suspend/pricing.
 */

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import type {
  CorporateContractRecord,
  CorporateContractStatus,
  CreateCorporateContractInput,
} from '@/domain/corporate-contract-schema';

const COLLECTION = 'corporate_contracts';

function mapDoc(
  id: string,
  data: Record<string, unknown>
): CorporateContractRecord {
  const ts = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };

  return {
    id,
    corporateId: String(data.corporateId || ''),
    companyName: String(data.companyName || ''),
    commercialRegistration: String(data.commercialRegistration || ''),
    vatNumber: String(data.vatNumber || ''),
    contactPerson: String(data.contactPerson || ''),
    contactPhone: data.contactPhone ? String(data.contactPhone) : undefined,
    billingAddress: String(data.billingAddress || ''),
    contractType: (data.contractType as CorporateContractRecord['contractType']) || 'monthly',
    startDate: String(data.startDate || ''),
    endDate: String(data.endDate || ''),
    services: Array.isArray(data.services)
      ? (data.services as CorporateContractRecord['services'])
      : [],
    paymentTerms:
      (data.paymentTerms as CorporateContractRecord['paymentTerms']) || 'net30',
    discountRate: Number(data.discountRate ?? 0),
    customPricingNotes: data.customPricingNotes
      ? String(data.customPricingNotes)
      : undefined,
    adminPricingRules: data.adminPricingRules
      ? String(data.adminPricingRules)
      : undefined,
    status: (data.status as CorporateContractStatus) || 'pending',
    adminNotes: data.adminNotes ? String(data.adminNotes) : undefined,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : null,
    reviewedAt: ts(data.reviewedAt) || null,
    createdAt: ts(data.createdAt),
    updatedAt: ts(data.updatedAt),
  };
}

/** Corporate submits a new contract registration (status = pending). */
export async function createCorporateContract(
  input: CreateCorporateContractInput
): Promise<CorporateContractRecord> {
  try {
    await ensureSignedInFirebaseUid(8000);
  } catch {
    await ensureFirebaseReady();
  }
  const id = `cc-${Date.now()}`;
  const enabledServices = input.services.filter((s) => s.enabled);

  const payload = {
    corporateId: input.corporateId,
    companyName: input.companyName.trim(),
    commercialRegistration: input.commercialRegistration.trim(),
    vatNumber: input.vatNumber.trim(),
    contactPerson: input.contactPerson.trim(),
    contactPhone: input.contactPhone?.trim() || null,
    billingAddress: input.billingAddress.trim(),
    contractType: input.contractType,
    startDate: input.startDate,
    endDate: input.endDate,
    services: enabledServices,
    paymentTerms: input.paymentTerms,
    discountRate: Math.max(0, Math.min(100, Number(input.discountRate) || 0)),
    customPricingNotes: input.customPricingNotes?.trim() || null,
    adminPricingRules: null,
    status: 'pending' as const,
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, COLLECTION, id), payload);

  // Mirror account status on corporates/{uid} for quick checks
  await setDoc(
    doc(db, 'corporates', input.corporateId),
    {
      uid: input.corporateId,
      companyName: payload.companyName,
      commercialRegistration: payload.commercialRegistration,
      vatNumber: payload.vatNumber,
      contactName: payload.contactPerson,
      billingAddress: payload.billingAddress,
      contractAccountStatus: 'pending',
      activeContractId: id,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return mapDoc(id, {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function listCorporateContractsForUser(
  corporateId: string
): Promise<CorporateContractRecord[]> {
  try {
    try {
      await ensureSignedInFirebaseUid(8000);
    } catch {
      await ensureFirebaseReady();
    }
    const q = query(
      collection(db, COLLECTION),
      where('corporateId', '==', corporateId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
  } catch (err) {
    console.warn('[corporateContractService] list for user failed:', err);
    // Fallback without orderBy if composite index missing
    try {
      const q = query(
        collection(db, COLLECTION),
        where('corporateId', '==', corporateId)
      );
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err2) {
      console.error('[corporateContractService] list fallback failed:', err2);
      return [];
    }
  }
}

/** Admin: list all corporate contract registrations. */
export async function listAllCorporateContracts(): Promise<CorporateContractRecord[]> {
  try {
    await ensureFirebaseReady();
    const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
  } catch (err) {
    console.warn('[corporateContractService] admin list ordered failed:', err);
    try {
      const snap = await getDocs(collection(db, COLLECTION));
      return snap.docs
        .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err2) {
      console.error('[corporateContractService] admin list failed:', err2);
      return [];
    }
  }
}

export type AdminContractUpdate = {
  status: CorporateContractStatus;
  discountRate?: number;
  adminPricingRules?: string;
  adminNotes?: string;
  reviewedBy?: string;
};

/** Admin activate / suspend / reject + assign pricing. */
export async function updateCorporateContractAdmin(
  contractId: string,
  corporateId: string,
  update: AdminContractUpdate
): Promise<void> {
  await ensureFirebaseReady();
  const contractRef = doc(db, COLLECTION, contractId);

  await updateDoc(contractRef, {
    status: update.status,
    ...(update.discountRate != null
      ? { discountRate: Math.max(0, Math.min(100, update.discountRate)) }
      : {}),
    ...(update.adminPricingRules != null
      ? { adminPricingRules: update.adminPricingRules.trim() || null }
      : {}),
    ...(update.adminNotes != null
      ? { adminNotes: update.adminNotes.trim() || null }
      : {}),
    reviewedBy: update.reviewedBy || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const accountStatus =
    update.status === 'active'
      ? 'active'
      : update.status === 'suspended'
        ? 'suspended'
        : update.status === 'rejected'
          ? 'rejected'
          : 'pending';

  await setDoc(
    doc(db, 'corporates', corporateId),
    {
      contractAccountStatus: accountStatus,
      activeContractId: contractId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
