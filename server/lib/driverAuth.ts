import admin from 'firebase-admin';
import { isDriverUserRole } from './adminDrivers.ts';
import { canonicalizeServiceType } from './serviceCategories.ts';

export interface ApprovedDriverProfile {
  uid: string;
  name: string;
  phone: string;
  role: 'driver' | 'b2c_driver';
  accountStatus: 'approved';
  /** Canonical vehicle category from drivers/{uid} or users/{uid}. */
  vehicleType: string | null;
}

/**
 * Server-side driver gate for order acceptance.
 * Requires b2c_driver/driver role and approved status on drivers/{uid} (fallback users/{uid}).
 */
export async function verifyApprovedDriverAccess(
  db: admin.firestore.Firestore,
  uid: string
): Promise<ApprovedDriverProfile> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw Object.assign(new Error('User profile not found'), { statusCode: 404 });
  }

  const user = userSnap.data() as Record<string, unknown>;
  if (!isDriverUserRole(user.role)) {
    throw Object.assign(new Error('Only approved drivers may accept orders'), { statusCode: 403 });
  }

  const driverSnap = await db.collection('drivers').doc(uid).get();
  const driver = driverSnap.data() as Record<string, unknown> | undefined;
  const status = String(driver?.accountStatus ?? user.accountStatus ?? 'pending');

  if (status === 'banned' || status === 'suspended' || status === 'rejected') {
    throw Object.assign(new Error('Driver account is blocked from accepting orders'), {
      statusCode: 403,
    });
  }

  if (status !== 'approved' && status !== 'active') {
    throw Object.assign(new Error('Driver account is not approved'), { statusCode: 403 });
  }

  const rawVehicle = String(driver?.vehicleType || user.vehicleType || '').trim();
  const vehicleType = canonicalizeServiceType(rawVehicle);

  return {
    uid,
    name: String(driver?.fullName || user.name || 'Driver'),
    phone: String(user.phone || driver?.phone || ''),
    role: user.role === 'b2c_driver' ? 'b2c_driver' : 'driver',
    accountStatus: 'approved',
    vehicleType,
  };
}
