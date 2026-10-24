import type { AppRole, RegistrableRole } from '@/domain/user-schema';

export type DriverDocumentKey =
  | 'license'
  | 'id'
  | 'registration'
  | 'permit'
  | 'plate'
  | 'vehicle';

/** Upload + admin review order. Plate photo and vehicle photo are required on new applications. */
export const DRIVER_DOCUMENT_KEYS: DriverDocumentKey[] = [
  'id',
  'license',
  'registration',
  'permit',
  'plate',
  'vehicle',
];

export type DocumentUploadStatus = 'not_uploaded' | 'uploaded';

export interface DriverDocumentUploadStatuses {
  license: DocumentUploadStatus;
  id: DocumentUploadStatus;
  registration: DocumentUploadStatus;
  permit: DocumentUploadStatus;
  plate: DocumentUploadStatus;
  vehicle: DocumentUploadStatus;
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
  plate: 'not_uploaded',
  vehicle: 'not_uploaded',
};

export interface ProfileBankDetails {
  iban: string;
  bankName: string;
  accountHolderName: string;
  transferIdentification?: string;
}

export interface StoredDocumentFile {
  status: 'uploaded';
  storagePath: string;
  url?: string;
  contentType?: string;
  fileName?: string;
  uploadedAt?: string;
}

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
  /** Optional vehicle photo URL (GCS signed download URL). */
  vehiclePhotoURL?: string;
  /** B2C driver fields */
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  /** Saudi National ID (1…) or Iqama (2…) — 10 digits */
  nationalId?: string;
  /** Gregorian YYYY-MM-DD. Required for WASL driver registration. */
  dateOfBirth?: string;
  /** Driving license number sent to WASL. */
  licenseNumber?: string;
  /** Vehicle registration / Istimara (Emarah) serial — WASL sequence number. */
  registrationSerial?: string;
  vehicleSequenceNumber?: string;
  plateLetterRight?: string;
  plateLetterMiddle?: string;
  plateLetterLeft?: string;
  plateDigits?: string;
  operatingCardNumber?: string;
  /** individual drivers pay their own IBAN; company drivers pay the operator IBAN. */
  payoutAccountKind?: 'individual' | 'company';
  operatorId?: string;
  bankDetails?: ProfileBankDetails;
  /** Commercial-registration scan for a fleet operator. */
  crDocument?: StoredDocumentFile;
  /** Document expiry dates (YYYY-MM-DD) for admin review */
  documentExpiries?: Partial<Record<DriverDocumentKey, string>>;
  documentUploadStatuses?: DriverDocumentUploadStatuses;
  /** Storage-backed KYC files (set after OTP upload). */
  documentFiles?: Partial<Record<DriverDocumentKey, DriverDocumentFileRecord>>;
  /** Driver application moderation status */
  accountStatus?: string;
  /** Store-reviewer dual-role account (`0500000000`). */
  playReview?: boolean;
  /** B2B organization fields */
  companyName?: string;
  commercialRegistration?: string;
}

/** Roles selectable on the public login / registration screen. */
export type LoginRole = RegistrableRole;
