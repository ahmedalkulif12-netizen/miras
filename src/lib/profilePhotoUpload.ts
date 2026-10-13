import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { prepareImageUpload } from '@/lib/prepareImageUpload';

async function postJson(path: string, body: unknown, label: string): Promise<Response> {
  try {
    return await authFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(`[upload] ${label} network error`, error);
    throw new Error('NETWORK_UPLOAD_FAILED');
  }
}

export async function uploadVehiclePhoto(
  file: File
): Promise<{ vehiclePhotoURL: string; storagePath: string }> {
  try {
    const prepared = await prepareImageUpload(file);
    const res = await postJson(
      '/api/users/vehicle-photo',
      {
        contentBase64: prepared.contentBase64,
        contentType: prepared.contentType,
        fileName: prepared.fileName,
      },
      'vehicle-photo'
    );

    if (!res.ok) {
      const message = await readApiErrorMessage(res, 'VEHICLE_PHOTO_UPLOAD_FAILED');
      console.error('[upload] vehicle photo rejected', { status: res.status, message });
      throw new Error(message);
    }

    const data = await readApiJson<{ vehiclePhotoURL: string; storagePath: string }>(res);
    if (!data.vehiclePhotoURL || !data.storagePath) {
      console.error('[upload] vehicle photo response missing URL', data);
      throw new Error('UPLOAD_URL_MISSING');
    }
    return data;
  } catch (error) {
    console.error('[upload] vehicle photo failed', {
      name: file.name,
      type: file.type,
      size: file.size,
      message: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function uploadProfilePhoto(file: File): Promise<{ photoURL: string; storagePath: string }> {
  try {
    const prepared = await prepareImageUpload(file);
    const res = await postJson(
      '/api/users/profile-photo',
      {
        contentBase64: prepared.contentBase64,
        contentType: prepared.contentType,
        fileName: prepared.fileName,
      },
      'profile-photo'
    );

    if (!res.ok) {
      const message = await readApiErrorMessage(res, 'PROFILE_PHOTO_UPLOAD_FAILED');
      console.error('[upload] profile photo rejected', { status: res.status, message });
      throw new Error(message);
    }

    const data = await readApiJson<{ photoURL: string; storagePath: string }>(res);
    if (!data.photoURL || !data.storagePath) {
      console.error('[upload] profile photo response missing URL', data);
      throw new Error('UPLOAD_URL_MISSING');
    }
    return data;
  } catch (error) {
    console.error('[upload] profile photo failed', {
      name: file.name,
      type: file.type,
      size: file.size,
      message: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}
