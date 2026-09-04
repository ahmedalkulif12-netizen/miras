/**
 * Driver KYC completeness — same four documents the registration form requires.
 * Returning drivers skip the form only when all four Storage-backed files exist.
 */

import {
  EMPTY_DRIVER_DOCUMENTS,
  type DriverDocumentFileRecord,
  type DriverDocumentKey,
  type DriverDocumentUploadStatuses,
  type UserProfile,
} from '@/lib/userProfile';

export const DRIVER_KYC_KEYS: DriverDocumentKey[] = [
  'id',
  'registration',
  'permit',
  'license',
];

export const DRIVER_REVIEW_SLA_HOURS = 24;

function asFileRecord(raw: unknown): DriverDocumentFileRecord | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return raw === 'uploaded' ? { status: 'uploaded' } : null;
  }
  if (typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const storagePath = String(obj.storagePath || obj.path || '').trim();
  const status =
    obj.status === 'uploaded' || storagePath ? 'uploaded' : 'not_uploaded';
  if (status !== 'uploaded') return null;
  return {
    status: 'uploaded',
    ...(storagePath ? { storagePath } : {}),
    ...(obj.url ? { url: String(obj.url) } : {}),
    ...(obj.contentType ? { contentType: String(obj.contentType) } : {}),
    ...(obj.fileName ? { fileName: String(obj.fileName) } : {}),
    ...(obj.uploadedAt ? { uploadedAt: String(obj.uploadedAt) } : {}),
  };
}

/** True when every required KYC image has a Storage path (not just a status flag). */
export function hasCompleteDriverKyc(
  source:
    | Pick<UserProfile, 'documentFiles' | 'documentUploadStatuses'>
    | Record<string, unknown>
    | null
    | undefined
): boolean {
  if (!source) return false;
  const extracted = extractDriverKyc(source);
  return DRIVER_KYC_KEYS.every((key) => Boolean(extracted.documentFiles[key]?.storagePath));
}

export function extractDriverKyc(source: {
  documentFiles?: UserProfile['documentFiles'];
  documentUploadStatuses?: DriverDocumentUploadStatuses;
  documents?: unknown;
  [key: string]: unknown;
}): {
  documentFiles: NonNullable<UserProfile['documentFiles']>;
  documentUploadStatuses: DriverDocumentUploadStatuses;
} {
  const documents =
    source.documents && typeof source.documents === 'object'
      ? (source.documents as Record<string, unknown>)
      : {};
  const files: NonNullable<UserProfile['documentFiles']> = {
    ...(source.documentFiles || {}),
  };
  const statuses: DriverDocumentUploadStatuses = {
    ...EMPTY_DRIVER_DOCUMENTS,
    ...(source.documentUploadStatuses || {}),
  };

  for (const key of DRIVER_KYC_KEYS) {
    const fromFiles = asFileRecord(files[key]);
    const fromDocs = asFileRecord(documents[key]);
    const record = fromFiles?.storagePath ? fromFiles : fromDocs || fromFiles;
    if (record?.storagePath) {
      files[key] = record;
      statuses[key] = 'uploaded';
    } else if (statuses[key] === 'uploaded' && !record?.storagePath) {
      statuses[key] = 'not_uploaded';
    }
  }

  return { documentFiles: files, documentUploadStatuses: statuses };
}
