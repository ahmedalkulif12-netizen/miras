import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import type { UserProfile } from '@/lib/userProfile';

export async function submitOperatorRegistrationToApi(
  profile: UserProfile
): Promise<{ uid: string; accountStatus: string }> {
  const res = await authFetch('/api/operators/registration', {
    method: 'POST',
    body: JSON.stringify({
      companyName: profile.companyName,
      contactName: profile.name,
      phone: profile.phone,
      commercialRegistration: profile.commercialRegistration,
      bankDetails: profile.bankDetails,
      crDocument: profile.crDocument,
    }),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'OPERATOR_REGISTRATION_FAILED'));
  }
  return readApiJson<{ uid: string; accountStatus: string }>(res);
}

export async function assignCompanyDriver(input: {
  driverUid: string;
  driverName?: string;
}): Promise<{ operatorId: string; driverUid: string }> {
  const res = await authFetch('/api/operators/drivers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'FLEET_DRIVER_ASSIGN_FAILED'));
  }
  return readApiJson<{ operatorId: string; driverUid: string }>(res);
}
