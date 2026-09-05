/**
 * Flat Firestore patch for a driver claiming an open offer.
 * Nested maps, nulls, and FieldValue sentinels are omitted — they trip
 * security rules and client validation on updateDoc.
 */

export const DRIVER_ACCEPT_STATUS = 'assigned' as const;

export type DriverAcceptInput = {
  driverId: string;
  name: string;
  phone: string;
  nowIso?: string;
};

export type DriverAcceptPatch = {
  status: typeof DRIVER_ACCEPT_STATUS;
  driverId: string;
  driverName: string;
  driverPhone: string;
  updatedAt: string;
  assignedAt: string;
};

export const DRIVER_ACCEPT_PATCH_KEYS = [
  'status',
  'driverId',
  'driverName',
  'driverPhone',
  'updatedAt',
  'assignedAt',
] as const;

export function buildDriverAcceptPatch(input: DriverAcceptInput): DriverAcceptPatch {
  const driverId = String(input.driverId || '').trim();
  const name = String(input.name || '').trim() || 'Driver';
  const phone = String(input.phone || '').trim();
  const nowIso = input.nowIso || new Date().toISOString();

  return {
    status: DRIVER_ACCEPT_STATUS,
    driverId,
    driverName: name,
    driverPhone: phone,
    updatedAt: nowIso,
    assignedAt: nowIso,
  };
}
