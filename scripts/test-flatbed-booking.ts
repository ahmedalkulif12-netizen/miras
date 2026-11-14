/**
 * Flatbed vehicle verification. Run: npx tsx scripts/test-flatbed-booking.ts
 */
import { composePlate, flatbedVehicleError } from '../src/domain/flatbedBooking';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(flatbedVehicleError({ vehicleMakeModel: 'تويوتا', plateNumber: 'أ ب ج 1234' }), 'photo or serial is required');
assert(
  flatbedVehicleError({
    vehicleMakeModel: 'Toyota Camry',
    plateNumber: composePlate('أبت', '1234'),
    serialNumber: '123456',
  }) === null,
  'serial number is enough without a photo'
);
assert(
  flatbedVehicleError({
    vehicleMakeModel: 'Toyota Camry',
    plateNumber: 'ABC 1234',
    istimaraUrl: 'https://firebasestorage.googleapis.com/example.jpg',
  }) === null,
  'https istimara photo is enough'
);
assert(
  flatbedVehicleError({
    vehicleMakeModel: 'Toyota Camry',
    plateNumber: 'ABC 1234',
    istimaraUrl: 'http://example.com/a.jpg',
  }),
  'istimara must be https'
);
assert(composePlate('أ ب ت', '12-34') === 'أبت 1234', 'plate keeps letters and digits');

console.log('flatbed booking checks passed');
