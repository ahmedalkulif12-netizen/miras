import admin from 'firebase-admin';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

export const KYC_DOC_KEYS = ['license', 'id', 'registration', 'permit'] as const;
export type KycDocKey = (typeof KYC_DOC_KEYS)[number];

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
    'hamula-cfc6c-driver-docs'
  );
}

export async function saveKycImageToStorage(input: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}): Promise<{ storagePath: string; url: string }> {
  const bucket = admin.storage().bucket(kycBucketName());
  await bucket.file(input.storagePath).save(input.buffer, {
    contentType: input.contentType,
    resumable: false,
    metadata: {
      metadata: input.metadata,
    },
  });
  const [url] = await bucket.file(input.storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    version: 'v4',
  });
  return { storagePath: input.storagePath, url };
}
