import admin from 'firebase-admin';
import { parseSaudiPlateParts } from '../../src/domain/accountProfiles.ts';
import {
  buildWaslDriverPayload,
  buildWaslLocationPayload,
  buildWaslTripCompletePayload,
  buildWaslTripStartPayload,
  buildWaslVehiclePayload,
  formatWaslTimestamp,
  readWaslEligibility,
  validateWaslDriver,
  validateWaslTripStart,
  validateWaslVehicle,
  type WaslDriverRegistration,
  type WaslLocationPing,
  type WaslTripComplete,
  type WaslTripStart,
  type WaslVehicleRegistration,
  type WaslWireResult,
} from '../../src/domain/wasl.ts';
import { callWasl } from './waslClient.ts';

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return String(value || '').trim();
}

export function driverWaslInput(data: Record<string, unknown>): WaslDriverRegistration {
  return {
    national_id: str(data.nationalId || data.national_id),
    date_of_birth: str(data.dateOfBirth || data.date_of_birth),
    license_number: str(data.licenseNumber || data.license_number),
    mobile_number: str(data.phone || data.mobileNumber || data.mobile_number),
    date_of_birth_hijri: str(data.dateOfBirthHijri || data.date_of_birth_hijri),
    email: str(data.email),
  };
}

export function vehicleWaslInput(data: Record<string, unknown>): WaslVehicleRegistration {
  const parsed = parseSaudiPlateParts(str(data.plateNumber));
  return {
    sequence_number: str(
      data.vehicleSequenceNumber || data.registrationSerial || data.sequenceNumber || data.sequence_number
    ),
    plate_number: str(data.plateDigits || data.plate_number || parsed?.plateDigits),
    plate_letter_right: str(data.plateLetterRight || data.plate_letter_right || parsed?.plateLetterRight),
    plate_letter_middle: str(data.plateLetterMiddle || data.plate_letter_middle || parsed?.plateLetterMiddle),
    plate_letter_left: str(data.plateLetterLeft || data.plate_letter_left || parsed?.plateLetterLeft),
    operating_card_number: str(data.operatingCardNumber || data.operating_card_number),
    operating_card_expiry: str(
      data.operatingCardExpiry ||
        data.operating_card_expiry ||
        (data.documentExpiries && typeof data.documentExpiries === 'object'
          ? (data.documentExpiries as Record<string, unknown>).permit
          : '')
    ),
  };
}

export async function registerWaslDriver(
  input: WaslDriverRegistration
): Promise<WaslWireResult> {
  const invalid = validateWaslDriver(input);
  if (invalid) return { ok: false, skipped: true, reason: invalid, reference: null };
  return callWasl('POST', '/drivers', buildWaslDriverPayload(input));
}

/** TGA driver inquiry. VALID means the driver may operate. */
export async function syncWaslDriverVerification(
  db: admin.firestore.Firestore,
  driverId: string
): Promise<WaslWireResult> {
  const snap = await db.collection('drivers').doc(driverId).get();
  if (!snap.exists) return { ok: false, skipped: true, reason: 'DRIVER_NOT_FOUND', reference: null };
  const input = driverWaslInput((snap.data() || {}) as Record<string, unknown>);
  const result = await verifyWaslDriver(input.national_id);
  await snap.ref.set(
    {
      waslEligibility: result.eligibility || null,
      waslEligibilityStatus: result.ok ? 'checked' : result.skipped ? 'skipped' : 'failed',
      waslEligibilityReason: result.reason || result.error || null,
      waslEligibilityCheckedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return result;
}

export async function verifyWaslDriver(nationalId: string): Promise<WaslWireResult> {
  const identity = String(nationalId || '').trim();
  if (!/^[12]\d{9}$/.test(identity)) {
    return { ok: false, skipped: true, reason: 'NATIONAL_ID_INVALID', reference: null };
  }
  const result = await callWasl(
    'GET',
    `/drivers/eligibility/${encodeURIComponent(identity)}`
  );
  const eligibility = readWaslEligibility(result.body);
  return {
    ...result,
    eligibility,
    reference: result.reference || eligibility,
  };
}

export async function registerWaslVehicle(
  input: WaslVehicleRegistration
): Promise<WaslWireResult> {
  const invalid = validateWaslVehicle(input);
  if (invalid) return { ok: false, skipped: true, reason: invalid, reference: null };
  return callWasl('POST', '/vehicles', buildWaslVehiclePayload(input));
}

export async function logWaslTripStart(input: WaslTripStart): Promise<WaslWireResult> {
  const invalid = validateWaslTripStart(input);
  if (invalid) return { ok: false, skipped: true, reason: invalid, reference: null };
  return callWasl('POST', '/trips', buildWaslTripStartPayload(input));
}

export async function logWaslLocation(input: WaslLocationPing): Promise<WaslWireResult> {
  if (!input.trip_number || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return { ok: false, skipped: true, reason: 'LOCATION_INVALID', reference: null };
  }
  const ping = buildWaslLocationPayload(input);
  const recordedAt = formatWaslTimestamp(input.recorded_at);
  return callWasl('POST', '/locations', {
    ...ping,
    locations: [
      {
        driverIdentityNumber: String(input.national_id || '').trim(),
        vehicleSequenceNumber: input.sequence_number,
        latitude: input.latitude,
        longitude: input.longitude,
        hasCustomer: true,
        updatedWhen: recordedAt,
        velocity: input.speed_kmh ?? 0,
        vehicleStatus: input.vehicle_status,
      },
    ],
  });
}

export async function logWaslTripComplete(input: WaslTripComplete): Promise<WaslWireResult> {
  const payload = buildWaslTripCompletePayload(input);
  return callWasl('PATCH', '/trips', {
    ...payload,
    trips: [
      {
        tripId: input.trip_number,
        dropoffTimestamp: formatWaslTimestamp(input.completed_at),
        destinationLatitude: input.latitude,
        destinationLongitude: input.longitude,
      },
    ],
  });
}

async function writeOrderWasl(
  db: admin.firestore.Firestore,
  orderId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const fields: Record<string, unknown> = {
    'wasl.updatedAt': new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(patch)) {
    fields[`wasl.${key}`] = value;
  }
  await db.collection('orders').doc(orderId).update(fields);
}

export async function syncWaslTripStart(
  db: admin.firestore.Firestore,
  orderId: string
): Promise<WaslWireResult> {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { ok: false, skipped: true, reason: 'ORDER_NOT_FOUND', reference: null };
  const order = orderSnap.data() as Record<string, unknown>;
  const existing = (order.wasl || {}) as Record<string, unknown>;
  if (existing.tripReference) {
    return { ok: true, reference: str(existing.tripReference), skipped: true, reason: 'ALREADY_STARTED' };
  }
  const driverId = str(order.driverId);
  const driverSnap = driverId ? await db.collection('drivers').doc(driverId).get() : null;
  const driver = (driverSnap?.data() || {}) as Record<string, unknown>;
  const vehicleId = str(order.vehicleId);
  const operatorId = str(driver.operatorId || order.operatorId);
  let vehicle: Record<string, unknown> = driver;
  if (operatorId && vehicleId) {
    const vehicleSnap = await db
      .collection('operators')
      .doc(operatorId)
      .collection('vehicles')
      .doc(vehicleId)
      .get();
    if (vehicleSnap.exists) vehicle = vehicleSnap.data() as Record<string, unknown>;
  }
  const driverInput = driverWaslInput(driver);
  const vehicleInput = vehicleWaslInput({ ...driver, ...vehicle });
  const startedAt = new Date().toISOString();
  const trip: WaslTripStart = {
    trip_number: orderId,
    national_id: driverInput.national_id,
    sequence_number: vehicleInput.sequence_number,
    departure_latitude: num(order.pickupLat ?? order.driverLat),
    departure_longitude: num(order.pickupLng ?? order.driverLng),
    destination_latitude: num(order.dropoffLat),
    destination_longitude: num(order.dropoffLng),
    departure_address: str(order.pickupAddress || order.pickup),
    destination_address: str(order.dropoffAddress || order.destination),
    started_at: startedAt,
  };
  const result = await logWaslTripStart(trip);
  await writeOrderWasl(db, orderId, {
    tripStart: result.ok ? 'logged' : result.skipped ? 'skipped' : 'failed',
    tripReference: result.reference || null,
    startReason: result.reason || result.error || null,
    startedAt,
  });
  return result;
}

const lastLocationSent = new Map<string, number>();
const LOCATION_GAP_MS = 15_000;

export async function syncWaslLocation(
  db: admin.firestore.Firestore,
  orderId: string,
  ping: { latitude: number; longitude: number; speed?: number; heading?: number }
): Promise<WaslWireResult> {
  const now = Date.now();
  const previous = lastLocationSent.get(orderId) || 0;
  if (now - previous < LOCATION_GAP_MS) {
    return { ok: true, skipped: true, reason: 'THROTTLED', reference: null };
  }
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { ok: false, skipped: true, reason: 'ORDER_NOT_FOUND', reference: null };
  const order = orderSnap.data() as Record<string, unknown>;
  const driverId = str(order.driverId);
  const driverSnap = driverId ? await db.collection('drivers').doc(driverId).get() : null;
  const driver = (driverSnap?.data() || {}) as Record<string, unknown>;
  const vehicle = vehicleWaslInput(driver);
  const wasl = (order.wasl || {}) as Record<string, unknown>;
  lastLocationSent.set(orderId, now);
  const result = await logWaslLocation({
    trip_number: str(wasl.tripReference) || orderId,
    national_id: driverWaslInput(driver).national_id,
    sequence_number: vehicle.sequence_number,
    latitude: ping.latitude,
    longitude: ping.longitude,
    speed_kmh: ping.speed,
    heading: ping.heading,
    recorded_at: new Date().toISOString(),
    vehicle_status: 'MOVING',
  });
  if (!result.skipped || result.reason !== 'WASL_NOT_CONFIGURED') {
    await writeOrderWasl(db, orderId, {
      lastLocationAt: new Date().toISOString(),
      lastLocationStatus: result.ok ? 'logged' : result.skipped ? 'skipped' : 'failed',
      lastLocationReason: result.reason || result.error || null,
    });
  }
  return result;
}

export async function syncWaslTripComplete(
  db: admin.firestore.Firestore,
  orderId: string
): Promise<WaslWireResult> {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { ok: false, skipped: true, reason: 'ORDER_NOT_FOUND', reference: null };
  const order = orderSnap.data() as Record<string, unknown>;
  const wasl = (order.wasl || {}) as Record<string, unknown>;
  if (wasl.tripComplete === 'logged') {
    return { ok: true, skipped: true, reason: 'ALREADY_COMPLETED', reference: str(wasl.tripReference) || null };
  }
  const completedAt = new Date().toISOString();
  const result = await logWaslTripComplete({
    trip_number: orderId,
    wasl_reference: str(wasl.tripReference) || undefined,
    latitude: num(order.dropoffLat ?? order.driverLat),
    longitude: num(order.dropoffLng ?? order.driverLng),
    completed_at: completedAt,
  });
  await writeOrderWasl(db, orderId, {
    tripComplete: result.ok ? 'logged' : result.skipped ? 'skipped' : 'failed',
    completeReason: result.reason || result.error || null,
    completedAt,
    tripReference: result.reference || wasl.tripReference || null,
  });
  return result;
}
