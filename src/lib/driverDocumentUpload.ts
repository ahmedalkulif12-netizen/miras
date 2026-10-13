/**
 * Client-side driver KYC upload via Miras API (Admin SDK → GCS).
 * Avoids requiring Firebase Storage Console setup.
 */

import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { prepareImageUpload } from '@/lib/prepareImageUpload';
import type { DriverDocumentKey } from '@/lib/userProfile';

export interface DriverDocumentFileMeta {
  status: 'uploaded';
  storagePath: string;
  url?: string;
  contentType: string;
  fileName: string;
  uploadedAt: string;
}

export type DriverDocumentFilesMap = Partial<
  Record<DriverDocumentKey, DriverDocumentFileMeta>
>;

async function postDocument(
  path: string,
  file: File,
  label: string
): Promise<Response> {
  const prepared = await prepareImageUpload(file);
  try {
    return await authFetch(path, {
      method: 'POST',
      body: JSON.stringify({
        contentBase64: prepared.contentBase64,
        contentType: prepared.contentType,
        fileName: prepared.fileName,
      }),
    });
  } catch (error) {
    console.error(`[upload] ${label} network error`, {
      name: file.name,
      type: file.type,
      size: file.size,
      message: error instanceof Error ? error.message : error,
    });
    throw new Error('NETWORK_UPLOAD_FAILED');
  }
}

/**
 * Upload driver KYC files after OTP via authenticated API.
 * Each file is compressed and the request waits for the storage URL.
 */
export async function uploadDriverDocumentFiles(
  _uid: string,
  files: Partial<Record<DriverDocumentKey, File>>
): Promise<DriverDocumentFilesMap> {
  const out: DriverDocumentFilesMap = {};
  const keys = Object.keys(files) as DriverDocumentKey[];

  for (const key of keys) {
    const file = files[key];
    if (!file) continue;
    const res = await postDocument(`/api/drivers/documents/${key}`, file, key);
    if (!res.ok) {
      const message = await readApiErrorMessage(res, `UPLOAD_${key.toUpperCase()}_FAILED`);
      console.error('[upload] driver document rejected', { key, status: res.status, message });
      throw new Error(message);
    }
    const data = await readApiJson<DriverDocumentFileMeta>(res);
    if (!data.storagePath || !data.url) {
      console.error('[upload] driver document response missing URL', { key, data });
      throw new Error('UPLOAD_URL_MISSING');
    }
    out[key] = {
      status: 'uploaded',
      storagePath: data.storagePath,
      url: data.url,
      contentType: data.contentType || file.type || 'image/jpeg',
      fileName: data.fileName || file.name,
      uploadedAt: data.uploadedAt || new Date().toISOString(),
    };
  }

  return out;
}

export function documentFilesToUploadStatuses(
  files: DriverDocumentFilesMap | undefined,
  fallback?: Partial<Record<DriverDocumentKey, 'uploaded' | 'not_uploaded'>>
): Record<DriverDocumentKey, 'uploaded' | 'not_uploaded'> {
  const keys: DriverDocumentKey[] = ['license', 'id', 'registration', 'permit'];
  const result = {} as Record<DriverDocumentKey, 'uploaded' | 'not_uploaded'>;
  for (const key of keys) {
    if (files?.[key]?.storagePath) {
      result[key] = 'uploaded';
    } else if (fallback?.[key] === 'uploaded') {
      result[key] = 'uploaded';
    } else {
      result[key] = 'not_uploaded';
    }
  }
  return result;
}

export async function uploadFleetVehicleDocumentFiles(
  vehicleId: string,
  files: Partial<Record<DriverDocumentKey, File>>
): Promise<DriverDocumentFilesMap> {
  const out: DriverDocumentFilesMap = {};
  const keys = Object.keys(files) as DriverDocumentKey[];

  for (const key of keys) {
    const file = files[key];
    if (!file) continue;
    const res = await postDocument(
      `/api/operators/vehicles/${encodeURIComponent(vehicleId)}/documents/${key}`,
      file,
      `fleet-${key}`
    );
    if (!res.ok) {
      const message = await readApiErrorMessage(res, `UPLOAD_${key.toUpperCase()}_FAILED`);
      console.error('[upload] fleet document rejected', { key, status: res.status, message });
      throw new Error(message);
    }
    const data = await readApiJson<DriverDocumentFileMeta>(res);
    if (!data.storagePath || !data.url) {
      console.error('[upload] fleet document response missing URL', { key, data });
      throw new Error('UPLOAD_URL_MISSING');
    }
    out[key] = {
      status: 'uploaded',
      storagePath: data.storagePath,
      url: data.url,
      contentType: data.contentType || file.type || 'image/jpeg',
      fileName: data.fileName || file.name,
      uploadedAt: data.uploadedAt || new Date().toISOString(),
    };
  }

  return out;
}
