/** Customer flatbed booking checks shared by the form and the checkout API. */

export type FlatbedServiceMode = 'workshop' | 'industrial' | 'taqdeer';

export interface FlatbedVehicleInput {
  vehicleMakeModel?: string | null;
  plateNumber?: string | null;
  serialNumber?: string | null;
  chassisNumber?: string | null;
  istimaraUrl?: string | null;
}

export function flatbedVehicleError(input: FlatbedVehicleInput): string | null {
  const make = String(input.vehicleMakeModel || '').trim();
  const plate = String(input.plateNumber || '').trim();
  const serial = String(input.serialNumber || '').replace(/\s/g, '');
  const chassis = String(input.chassisNumber || '').replace(/\s/g, '').toUpperCase();
  const photo = String(input.istimaraUrl || '').trim();

  if (make.length < 2) return 'Enter the car make and model';
  if (plate.length < 2) return 'Enter the license plate';
  if (serial && !/^\d{4,15}$/.test(serial)) return 'Serial number must be 4 to 15 digits';
  if (chassis && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(chassis)) {
    return 'Chassis / VIN must be 11 to 17 letters and digits';
  }
  if (photo && !/^https:\/\//i.test(photo)) return 'Istimara photo must be an uploaded image';
  if (!photo && serial.length < 4 && chassis.length < 11) {
    return 'Upload the istimara or enter the serial or chassis number';
  }
  return null;
}

export function composePlate(letters: string, digits: string): string {
  const cleanLetters = letters.replace(/\s+/g, '').slice(0, 3);
  const cleanDigits = digits.replace(/\D/g, '').slice(0, 4);
  return [cleanLetters, cleanDigits].filter(Boolean).join(' ').trim();
}
