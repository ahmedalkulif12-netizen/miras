import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { firebaseApp } from '@/lib/firebase';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Customer istimara photo. Path matches storage.rules users/{uid}/vehicle. */
export async function uploadIstimaraImage(uid: string, file: File): Promise<{
  url: string;
  path: string;
}> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('Use a JPEG, PNG, or WebP photo');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Photo must be under 5 MB');
  }
  const safeName = file.name.replace(/[^\w.]+/g, '').slice(-24) || 'istimara.jpg';
  const path = `users/${uid}/vehicle/istimara-${Date.now()}-${safeName}`;
  const storageRef = ref(getStorage(firebaseApp), path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { url, path };
}
