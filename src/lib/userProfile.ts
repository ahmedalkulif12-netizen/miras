import type { AppRole, RegistrableRole } from '@/domain/user-schema';

export type DriverDocumentKey = 'license' | 'id' | 'registration' | 'permit';

export type DocumentUploadStatus = 'not_uploaded' | 'uploaded';

export interface DriverDocumentUploadStatuses {
  license: DocumentUploadStatus;
  id: DocumentUploadStatus;
  registration: DocumentUploadStatus;
  permit: DocumentUploadStatus;
}

/** Rich Storage-backed document metadata (preferred over status-only flags). */
export interface DriverDocumentFileRecord {
  status: DocumentUploadStatus;
  storagePath?: string;
  url?: string;
  contentType?: string;
  fileName?: string;
  uploadedAt?: string;
}

export type DriverDocumentsRecord = Partial<Record<DriverDocumentKey, DriverDocumentFileRecord | DocumentUploadStatus>>;

export const EMPTY_DRIVER_DOCUMENTS: DriverDocumentUploadStatuses = {
  license: 'not_uploaded',
  id: 'not_uploaded',
  registration: 'not_uploaded',
  permit: 'not_uploaded',
};

/**
 * In-memory / cached auth profile.
 * `role` is always a canonical AppRole after restore/normalize.
 */
export interface UserProfile {
  uid: string;
  phone: string;
  role: AppRole;
  name: string;
  /** Optional profile avatar URL (GCS signed or public download URL). */
  photoURL?: string;
  /** B2C driver fields */
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  /** Saudi National ID (1…) or Iqama (2…) — 10 digits */
  nationalId?: string;
  /** Vehicle registration / Istimara (Emarah) serial */
  registrationSerial?: string;
  /** Document expiry dates (YYYY-MM-DD) for admin review */
  documentExpiries?: Partial<Record<DriverDocumentKey, string>>;
  documentUploadStatuses?: DriverDocumentUploadStatuses;
  /** Storage-backed KYC files (set after OTP upload). */
  documentFiles?: Partial<Record<DriverDocumentKey, DriverDocumentFileRecord>>;
  /** Driver application moderation status */
  accountStatus?: string;
  /** B2B organization fields */
  companyName?: string;
  commercialRegistration?: string;
}

/** Roles selectable on the public login / registration screen. */
export type LoginRole = RegistrableRole;
