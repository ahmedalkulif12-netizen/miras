import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import type { UserProfile } from '@/lib/userProfile';
import { APP_ROLES, normalizeAppRole } from '@/domain/user-schema';

/**
 * Server-side pending driver upsert (Admin SDK).
 * Ensures admin /api/admin/drivers can see new applications immediately.
 */
export async function submitDriverRegistrationToApi(
  profile: UserProfile
): Promise<{ uid: string; accountStatus: string; created: boolean }> {
  const role = normalizeAppRole(profile.role);
  if (role !== APP_ROLES.B2C_DRIVER) {
    throw new Error('NOT_A_DRIVER_PROFILE');
  }

  const res = await authFetch('/api/drivers/registration', {
    method: 'POST',
    body: JSON.stringify({
      name: profile.name,
      phone: profile.phone,
      vehicleType: profile.vehicleType,
      vehicleOption: profile.vehicleOption,
      plateNumber: profile.plateNumber,
      nationalId: profile.nationalId,
      registrationSerial: profile.registrationSerial,
      documentUploadStatuses: profile.documentUploadStatuses,
      documentExpiries: profile.documentExpiries,
      documentFiles: profile.documentFiles,
    }),
  });

  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'DRIVER_REGISTRATION_FAILED'));
  }

  return readApiJson<{ uid: string; accountStatus: string; created: boolean }>(res);
}
