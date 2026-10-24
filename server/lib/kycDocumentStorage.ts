import { randomUUID } from 'node:crypto';
import admin from 'firebase-admin';
import { MIRAS_PRODUCTION_STORAGE_BUCKET } from '../../src/lib/mirasProductionFirebase.ts';
import {
  DRIVER_DOCUMENT_KEYS,
  type DriverDocumentKey,
} from '../../src/lib/userProfile.ts';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

export const KYC_DOC_KEYS = DRIVER_DOCUMENT_KEYS;
export type KycDocKey = DriverDocumentKey;

export function isKycDocKey(value: string): value is KycDocKey {
  return (KYC_DOC_KEYS as readonly string[]).includes(value);
}

function isJpegOrPngBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  return jpeg || png;
}

export function decodeKycImage(input: {
  contentBase64: string;
  contentType?: string;
}): { buffer: Buffer; contentType: string } {
  const contentType = String(input.contentType || '').toLowerCase() || 'image/jpeg';
  if (!ALLOWED_MIME.has(contentType)) {
    throw Object.assign(new Error('Only JPEG or PNG images are allowed'), { statusCode: 400 });
  }
  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (!buffer.length) {
    throw Object.assign(new Error('Selected file is empty'), { statusCode: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error('Each document must be 5 MB or smaller'), { statusCode: 400 });
  }
  if (!isJpegOrPngBuffer(buffer)) {
    throw Object.assign(new Error('File is not a valid JPEG or PNG image'), { statusCode: 400 });
  }
  return {
    buffer,
    contentType: contentType === 'image/jpg' ? 'image/jpeg' : contentType,
  };
}

export function missingKycDocumentKeys(
  documents: Record<string, unknown> | undefined
): KycDocKey[] {
  return KYC_DOC_KEYS.filter((key) => {
    const raw = documents?.[key];
    const asObj = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : null;
    const storagePath = String(asObj?.storagePath || asObj?.path || '');
    return !storagePath;
  });
}

export function hasCompleteKycDocuments(
  documents: Record<string, unknown> | undefined
): boolean {
  return missingKycDocumentKeys(documents).length === 0;
}

export function mergeKycDocument(
  existing: Record<string, unknown> | undefined,
  docKey: string,
  meta: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    [docKey]: meta,
  };
}

export function kycBucketName(): string {
  return (
    process.env.DRIVER_DOCS_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    MIRAS_PRODUCTION_STORAGE_BUCKET
  );
}

/** Long-lived Firebase download URL. V4 signed URLs cannot exceed 7 days. */
export function firebaseDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
}

export async function saveImageToStorage(input: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}): Promise<{ storagePath: string; url: string }> {
  const bucket = admin.storage().bucket(kycBucketName());
  const token = randomUUID();
  const file = bucket.file(input.storagePath);
  try {
    await file.save(input.buffer, {
      contentType: input.contentType,
      resumable: false,
      metadata: {
        cacheControl: 'public, max-age=31536000',
        metadata: {
          ...input.metadata,
          firebaseStorageDownloadTokens: token,
        },
      },
    });
  } catch (error) {
    const code = (error as { code?: string | number })?.code;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[storage] image save failed', {
      bucket: bucket.name,
      storagePath: input.storagePath,
      contentType: input.contentType,
      bytes: input.buffer.length,
      code,
      message,
    });
    throw error;
  }

  return {
    storagePath: input.storagePath,
    url: firebaseDownloadUrl(bucket.name, input.storagePath, token),
  };
}

export async function saveKycImageToStorage(input: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}): Promise<{ storagePath: string; url: string }> {
  return saveImageToStorage(input);
}

/** Prefer the stored download token. Fall back to a signed URL inside the 7-day V4 limit. */
export async function readableStorageUrl(storagePath: string): Promise<string> {
  const bucket = admin.storage().bucket(kycBucketName());
  const file = bucket.file(storagePath);
  try {
    const [metadata] = await file.getMetadata();
    const raw = metadata.metadata?.firebaseStorageDownloadTokens;
    const token = String(raw || '').split(',')[0]?.trim();
    if (token) return firebaseDownloadUrl(bucket.name, storagePath, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[storage] metadata read failed', {
      bucket: bucket.name,
      storagePath,
      message,
    });
  }

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 6 * 24 * 60 * 60 * 1000,
    version: 'v4',
  });
  return url;
}
