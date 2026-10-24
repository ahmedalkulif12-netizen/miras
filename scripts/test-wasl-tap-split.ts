/**
 * Pure checks for WASL payloads, company vs individual payout, and the 15/85 Tap split.
 * Run: npx tsx scripts/test-wasl-tap-split.ts
 */
import assert from 'node:assert/strict';
import {
  buildWaslDriverPayload,
  buildWaslLocationPayload,
  buildWaslTripCompletePayload,
  buildWaslTripStartPayload,
  buildWaslVehiclePayload,
  validateWaslDriver,
  validateWaslVehicle,
} from '../src/domain/wasl.ts';
import {
  parseSaudiPlateParts,
  resolvePayoutAccount,
  validateCompanyCompliance,
  validateIndividualCompliance,
} from '../src/domain/accountProfiles.ts';
import { splitTapCharge, tapDestinationEntry } from '../src/domain/tapSplit.ts';
import { callWasl, isWaslConfigured } from '../server/lib/waslClient.ts';

const driver = buildWaslDriverPayload({
  national_id: '1234567890',
  date_of_birth: '1990-01-15',
  license_number: 'DL12345',
  mobile_number: '0551234567',
});
assert.equal(driver.national_id, '1234567890');
assert.equal(driver.identityNumber, '1234567890');
assert.equal(driver.mobile_number, '966551234567');
assert.equal(driver.license_number, 'DL12345');
assert.equal(validateWaslDriver({
  national_id: '1234567890',
  date_of_birth: '1990-01-15',
  license_number: 'DL12345',
  mobile_number: '0551234567',
}), null);
assert.equal(validateWaslDriver({
  national_id: '3234567890',
  date_of_birth: '1990-01-15',
  license_number: 'DL12345',
  mobile_number: '0551234567',
}), 'NATIONAL_ID_INVALID');

const plate = parseSaudiPlateParts('أ ب ح 1234');
assert.deepEqual(plate, {
  plateLetterRight: 'أ',
  plateLetterMiddle: 'ب',
  plateLetterLeft: 'ح',
  plateDigits: '1234',
});

const vehicle = buildWaslVehiclePayload({
  sequence_number: '12345678',
  plate_number: '1234',
  plate_letter_right: 'أ',
  plate_letter_middle: 'ب',
  plate_letter_left: 'ح',
  operating_card_number: 'OC-1001',
  operating_card_expiry: '2027-06-01',
});
assert.equal(vehicle.sequence_number, '12345678');
assert.equal(vehicle.operating_card_number, 'OC-1001');
assert.equal(
  (vehicle.plate as { rightLetter: string }).rightLetter,
  'أ'
);
assert.equal(validateWaslVehicle({
  sequence_number: '12345678',
  plate_number: '1234',
  plate_letter_right: 'أ',
  plate_letter_middle: 'ب',
  plate_letter_left: 'ح',
  operating_card_number: 'OC-1001',
  operating_card_expiry: '2027-06-01',
}), null);

const trip = buildWaslTripStartPayload({
  trip_number: 'order-1',
  national_id: '1234567890',
  sequence_number: '12345678',
  departure_latitude: 24.7,
  departure_longitude: 46.7,
  destination_latitude: 21.4,
  destination_longitude: 39.8,
  departure_address: 'Riyadh',
  destination_address: 'Jeddah',
  started_at: '2026-10-24T12:00:00.000Z',
});
assert.equal(trip.tripNumber, 'order-1');
assert.equal(trip.departureLatitude, 24.7);

const ping = buildWaslLocationPayload({
  trip_number: 'order-1',
  sequence_number: '12345678',
  latitude: 24.8,
  longitude: 46.8,
  speed_kmh: 60,
  heading: 90,
  recorded_at: '2026-10-24T12:05:00.000Z',
  vehicle_status: 'MOVING',
});
assert.equal(ping.vehicleStatus, 'MOVING');

const done = buildWaslTripCompletePayload({
  trip_number: 'order-1',
  wasl_reference: 'ref-9',
  latitude: 21.4,
  longitude: 39.8,
  completed_at: '2026-10-24T18:00:00.000Z',
});
assert.equal(done.wasl_reference, 'ref-9');
assert.equal(done.arrivedWhen, '2026-10-24T18:00:00.000Z');

assert.equal(validateIndividualCompliance({
  dateOfBirth: '2015-01-01',
  licenseNumber: 'DL12345',
  plateNumber: 'أ ب ح 1234',
  operatingCardNumber: 'OC-1001',
  operatingCardExpiry: '2027-06-01',
  bank: {
    iban: 'SA0380000000608010167519',
    bankName: 'Al Rajhi',
    accountHolderName: 'Driver',
    transferIdentification: 'TR-1',
  },
}), 'DATE_OF_BIRTH_INVALID');

assert.equal(validateCompanyCompliance({
  companyName: 'Fleet Co',
  commercialRegistration: '1010123456',
  bank: {
    iban: 'SA0380000000608010167519',
    bankName: 'Al Rajhi',
    accountHolderName: 'Fleet Co',
  },
}), null);
assert.equal(validateCompanyCompliance({
  companyName: 'Fleet Co',
  commercialRegistration: '1010',
  bank: {
    iban: 'SA0380000000608010167519',
    bankName: 'Al Rajhi',
    accountHolderName: 'Fleet Co',
  },
}), 'CR_INVALID');

assert.deepEqual(resolvePayoutAccount({ driverId: 'drv', operatorId: 'op' }), {
  kind: 'company',
  ownerId: 'op',
});
assert.deepEqual(resolvePayoutAccount({ driverId: 'drv' }), {
  kind: 'individual',
  ownerId: 'drv',
});

const fromFinancials = splitTapCharge(173.25, {
  tripFare: 165,
  driverNet: 140.25,
  customerTotal: 173.25,
});
assert.equal(fromFinancials.payeeAmount, 140.25);
assert.equal(fromFinancials.platformAmount, 33);
assert.equal(fromFinancials.source, 'financials');

const fixed = splitTapCharge(100, null);
assert.equal(fixed.payeeAmount, 85);
assert.equal(fixed.platformAmount, 15);
assert.equal(fixed.source, 'fixed_15_85');

const clamped = splitTapCharge(50, { tripFare: 165, driverNet: 140.25 });
assert.equal(clamped.payeeAmount, 50);
assert.equal(clamped.platformAmount, 0);

assert.deepEqual(tapDestinationEntry('dest_1', 85), {
  id: 'dest_1',
  amount: 85,
  currency: 'SAR',
});
assert.equal(tapDestinationEntry('', 85), null);

const emptyWasl = { baseUrl: '', apiKey: '', clientId: '', appId: '' };
assert.equal(isWaslConfigured(emptyWasl), false);
const skippedWasl = await callWasl('POST', '/tracking/v1/drivers', { national_id: 'x' }, emptyWasl);
assert.equal(skippedWasl.skipped, true);
assert.equal(skippedWasl.reason, 'WASL_NOT_CONFIGURED');
assert.equal(
  isWaslConfigured({
    baseUrl: 'https://wasl.tga.gov.sa/api',
    apiKey: '',
    clientId: '',
    appId: '',
  }),
  false
);

console.log('wasl + tap split checks passed');
