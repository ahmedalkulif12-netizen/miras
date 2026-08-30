/**
 * Client-side driver KYC upload via Miras API (Admin SDK → GCS).
 * Avoids requiring Firebase Storage Console setup.
 */

import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FILE_READ_FAILED'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Upload driver KYC files after OTP via authenticated API.
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
    const contentBase64 = await fileToBase64(file);
    const res = await authFetch(`/api/drivers/documents/${key}`, {
      method: 'POST',
      body: JSON.stringify({
        contentBase64,
        contentType: file.type || 'application/octet-stream',
        fileName: file.name,
      }),
    });
    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, `UPLOAD_${key.toUpperCase()}_FAILED`));
    }
    const data = await readApiJson<DriverDocumentFileMeta>(res);
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
    const contentBase64 = await fileToBase64(file);
    const res = await authFetch(
      `/api/operators/vehicles/${encodeURIComponent(vehicleId)}/documents/${key}`,
      {
        method: 'POST',
        body: JSON.stringify({
          contentBase64,
          contentType: file.type || 'image/jpeg',
          fileName: file.name,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, `UPLOAD_${key.toUpperCase()}_FAILED`));
    }
    const data = await readApiJson<DriverDocumentFileMeta>(res);
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
