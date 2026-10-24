/**
 * TGA / WASL (وصل) payload models for driver, vehicle, and waybill sync.
 *
 * Domain fields use the names the registration form collects. The wire body
 * also includes the camelCase aliases the WASL tracking API accepts
 * (`identityNumber`, `sequenceNumber`, nested `plate`).
 * Credentials and HTTP live in `server/lib/waslClient.ts`.
 */

export interface WaslDriverRegistration {
  national_id: string;
  date_of_birth: string;
  license_number: string;
  mobile_number: string;
}

export interface WaslVehicleRegistration {
  sequence_number: string;
  plate_number: string;
  plate_letter_right: string;
  plate_letter_middle: string;
  plate_letter_left: string;
  operating_card_number: string;
  operating_card_expiry: string;
}

export interface WaslTripStart {
  trip_number: string;
  national_id: string;
  sequence_number: string;
  departure_latitude: number;
  departure_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  departure_address: string;
  destination_address: string;
  started_at: string;
}

export interface WaslLocationPing {
  trip_number: string;
  sequence_number: string;
  latitude: number;
  longitude: number;
  speed_kmh?: number;
  heading?: number;
  recorded_at: string;
  vehicle_status: 'MOVING' | 'PARKED' | 'STOPPED';
}

export interface WaslTripComplete {
  trip_number: string;
  wasl_reference?: string;
  latitude: number;
  longitude: number;
  completed_at: string;
}

export interface WaslWireResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  reference?: string | null;
  httpStatus?: number | null;
  error?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toWaslMobile(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('966') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('05') && digits.length >= 10) return `966${digits.slice(1, 10)}`;
  if (digits.startsWith('5') && digits.length >= 9) return `966${digits.slice(0, 9)}`;
  return null;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function finiteCoord(value: number, max: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= max && !(value === 0);
}

export function buildWaslDriverPayload(input: WaslDriverRegistration): Record<string, string> {
  const mobile = toWaslMobile(input.mobile_number) || String(input.mobile_number || '').trim();
  const nationalId = String(input.national_id || '').trim();
  const dob = String(input.date_of_birth || '').trim();
  const license = String(input.license_number || '').trim();
  return {
    national_id: nationalId,
    date_of_birth: dob,
    license_number: license,
    mobile_number: mobile,
    identityNumber: nationalId,
    dateOfBirthGregorian: dob,
    drivingLicenseNumber: license,
    mobileNumber: mobile,
  };
}

export function buildWaslVehiclePayload(input: WaslVehicleRegistration): Record<string, unknown> {
  const sequence = String(input.sequence_number || '').trim();
  const plateNumber = String(input.plate_number || '').trim();
  const right = String(input.plate_letter_right || '').trim();
  const middle = String(input.plate_letter_middle || '').trim();
  const left = String(input.plate_letter_left || '').trim();
  const card = String(input.operating_card_number || '').trim();
  const expiry = String(input.operating_card_expiry || '').trim();
  return {
    sequence_number: sequence,
    plate_number: plateNumber,
    plate_letter_right: right,
    plate_letter_middle: middle,
    plate_letter_left: left,
    operating_card_number: card,
    operating_card_expiry: expiry,
    sequenceNumber: sequence,
    operatingCardNumber: card,
    operatingCardExpiry: expiry,
    plate: {
      number: plateNumber,
      rightLetter: right,
      middleLetter: middle,
      leftLetter: left,
    },
  };
}

export function buildWaslTripStartPayload(input: WaslTripStart): Record<string, unknown> {
  return {
    trip_number: input.trip_number,
    national_id: input.national_id,
    sequence_number: input.sequence_number,
    departure_latitude: input.departure_latitude,
    departure_longitude: input.departure_longitude,
    destination_latitude: input.destination_latitude,
    destination_longitude: input.destination_longitude,
    departure_address: input.departure_address,
    destination_address: input.destination_address,
    started_at: input.started_at,
    tripNumber: input.trip_number,
    driverIdentityNumber: input.national_id,
    vehicleSequenceNumber: input.sequence_number,
    departureLatitude: input.departure_latitude,
    departureLongitude: input.departure_longitude,
    expectedDestinationLatitude: input.destination_latitude,
    expectedDestinationLongitude: input.destination_longitude,
    departureAddress: input.departure_address,
    destinationAddress: input.destination_address,
  };
}

export function buildWaslLocationPayload(input: WaslLocationPing): Record<string, unknown> {
  return {
    trip_number: input.trip_number,
    sequence_number: input.sequence_number,
    latitude: input.latitude,
    longitude: input.longitude,
    speed_kmh: input.speed_kmh ?? 0,
    heading: input.heading ?? 0,
    recorded_at: input.recorded_at,
    vehicle_status: input.vehicle_status,
    tripNumber: input.trip_number,
    vehicleSequenceNumber: input.sequence_number,
    locationTime: input.recorded_at,
    velocity: input.speed_kmh ?? 0,
    vehicleStatus: input.vehicle_status,
  };
}

export function buildWaslTripCompletePayload(input: WaslTripComplete): Record<string, unknown> {
  return {
    trip_number: input.trip_number,
    wasl_reference: input.wasl_reference || '',
    latitude: input.latitude,
    longitude: input.longitude,
    completed_at: input.completed_at,
    tripNumber: input.trip_number,
    actualDestinationLatitude: input.latitude,
    actualDestinationLongitude: input.longitude,
    arrivedWhen: input.completed_at,
  };
}

export function validateWaslDriver(input: WaslDriverRegistration): string | null {
  if (!/^[12]\d{9}$/.test(String(input.national_id || '').trim())) return 'NATIONAL_ID_INVALID';
  if (!isIsoDate(String(input.date_of_birth || '').trim())) return 'DATE_OF_BIRTH_INVALID';
  if (!/^[A-Za-z0-9-]{4,20}$/.test(String(input.license_number || '').trim())) {
    return 'LICENSE_NUMBER_INVALID';
  }
  if (!toWaslMobile(input.mobile_number)) return 'MOBILE_INVALID';
  return null;
}

export function validateWaslVehicle(input: WaslVehicleRegistration): string | null {
  if (!/^[A-Za-z0-9]{4,20}$/.test(String(input.sequence_number || '').trim())) {
    return 'SEQUENCE_NUMBER_INVALID';
  }
  if (!/^\d{1,4}$/.test(String(input.plate_number || '').trim())) return 'PLATE_NUMBER_INVALID';
  for (const letter of [
    input.plate_letter_right,
    input.plate_letter_middle,
    input.plate_letter_left,
  ]) {
    if (!String(letter || '').trim() || String(letter).trim().length > 2) return 'PLATE_LETTER_INVALID';
  }
  if (!/^[A-Za-z0-9/-]{4,30}$/.test(String(input.operating_card_number || '').trim())) {
    return 'OPERATING_CARD_INVALID';
  }
  if (!isIsoDate(String(input.operating_card_expiry || '').trim())) {
    return 'OPERATING_CARD_EXPIRY_INVALID';
  }
  return null;
}

export function validateWaslTripStart(input: WaslTripStart): string | null {
  if (!String(input.trip_number || '').trim()) return 'TRIP_NUMBER_REQUIRED';
  if (!finiteCoord(input.departure_latitude, 90) || !finiteCoord(input.departure_longitude, 180)) {
    return 'DEPARTURE_COORDS_INVALID';
  }
  if (!finiteCoord(input.destination_latitude, 90) || !finiteCoord(input.destination_longitude, 180)) {
    return 'DESTINATION_COORDS_INVALID';
  }
  return null;
}

export function readWaslReference(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const result =
    obj.result && typeof obj.result === 'object' ? (obj.result as Record<string, unknown>) : null;
  const ref =
    result?.referenceKey ||
    result?.reference ||
    result?.tripReference ||
    obj.referenceKey ||
    obj.reference ||
    obj.id;
  const text = ref == null ? '' : String(ref).trim();
  return text || null;
}

export function waslCallSucceeded(body: unknown, httpStatus: number): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (!body || typeof body !== 'object') return true;
  const code = String(
    (body as Record<string, unknown>).resultCode ||
      (body as Record<string, unknown>).code ||
      ''
  )
    .trim()
    .toLowerCase();
  if (!code) return true;
  return code === 'success' || code === 'ok' || code === '0' || code === '200';
}
