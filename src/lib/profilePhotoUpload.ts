import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';

const MAX_PROFILE_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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

export function validateProfilePhotoFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    return { ok: false, message: 'PHOTO_TYPE_INVALID' };
  }
  if (!file.size || file.size > MAX_PROFILE_PHOTO_BYTES) {
    return { ok: false, message: 'PHOTO_TOO_LARGE' };
  }
  return { ok: true };
}

export async function uploadProfilePhoto(file: File): Promise<{ photoURL: string; storagePath: string }> {
  const check = validateProfilePhotoFile(file);
  if (check.ok === false) {
    throw Object.assign(new Error(check.message), { code: check.message });
  }

  const contentBase64 = await fileToBase64(file);
  const res = await authFetch('/api/users/profile-photo', {
    method: 'POST',
    body: JSON.stringify({
      contentBase64,
      contentType: file.type || 'image/jpeg',
      fileName: file.name,
    }),
  });

  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'PROFILE_PHOTO_UPLOAD_FAILED'));
  }

  return readApiJson<{ photoURL: string; storagePath: string }>(res);
}
