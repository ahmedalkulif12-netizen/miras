/**
 * Canonical Firestore patch for driver Accept Order (موافقة الطلب).
 * Only string/map values allowed by firestore.rules `driverClaimKeys()`.
 * No nulls, FieldValue sentinels, or statusHistory transforms.
 */

export const DRIVER_ACCEPT_STATUS = 'assigned' as const;

export type DriverAcceptInput = {
  driverId: string;
  name: string;
  phone: string;
  truckDetails?: string;
  nowIso?: string;
};

export type DriverAcceptPatch = {
  status: typeof DRIVER_ACCEPT_STATUS;
  driverId: string;
  driverName: string;
  driverPhone: string;
  updatedAt: string;
  assignedAt: string;
  driver: {
    id: string;
    name: string;
    phone: string;
    truckDetails: string;
  };
};

export const DRIVER_ACCEPT_PATCH_KEYS = [
  'status',
  'driverId',
  'driverName',
  'driverPhone',
  'updatedAt',
  'assignedAt',
  'driver',
] as const;

export function buildDriverAcceptPatch(input: DriverAcceptInput): DriverAcceptPatch {
  const driverId = String(input.driverId || '').trim();
  const name = String(input.name || '').trim() || 'Driver';
  const phone = String(input.phone || '').trim();
  const truckDetails = String(input.truckDetails || '').trim();
  const nowIso = input.nowIso || new Date().toISOString();

  return {
    status: DRIVER_ACCEPT_STATUS,
    driverId,
    driverName: name,
    driverPhone: phone,
    updatedAt: nowIso,
    assignedAt: nowIso,
    driver: {
      id: driverId,
      name,
      phone,
      truckDetails,
    },
  };
}
