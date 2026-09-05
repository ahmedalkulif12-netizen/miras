/**
 * Canonical Firestore patch for a driver claiming an open offer.
 * Keys must stay compatible with firestore.rules driver claim updates.
 */

export const DRIVER_ACCEPT_STATUS = 'assigned' as const;

export type DriverAcceptInput = {
  driverId: string;
  name: string;
  phone: string;
  truckDetails: string;
  vehicleType?: string | null;
};

export type DriverAcceptPatch = {
  status: typeof DRIVER_ACCEPT_STATUS;
  driverId: string;
  driverName: string;
  driverPhone: string;
  driver: {
    id: string;
    name: string;
    phone: string;
    truckDetails: string;
    vehicleType: string | null;
  };
};

export const DRIVER_ACCEPT_PATCH_KEYS = [
  'status',
  'driverId',
  'driverName',
  'driverPhone',
  'driver',
  'statusHistory',
  'updatedAt',
  'assignedAt',
] as const;

export function buildDriverAcceptPatch(input: DriverAcceptInput): DriverAcceptPatch {
  const driverId = String(input.driverId || '').trim();
  const name = String(input.name || '').trim() || 'Driver';
  const phone = String(input.phone || '').trim();
  const truckDetails = String(input.truckDetails || '').trim();
  const vehicleType = input.vehicleType ? String(input.vehicleType).trim() : '';

  return {
    status: DRIVER_ACCEPT_STATUS,
    driverId,
    driverName: name,
    driverPhone: phone,
    driver: {
      id: driverId,
      name,
      phone,
      truckDetails,
      vehicleType: vehicleType || null,
    },
  };
}
