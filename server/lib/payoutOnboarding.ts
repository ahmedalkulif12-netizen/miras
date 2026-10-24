import admin from 'firebase-admin';
import { getServerConfig } from '../config/env.ts';
import { normalizeIban } from '../../src/domain/accountProfiles.ts';
import { createTapDestination } from './tapDestinations.ts';
import { driverWaslInput, registerWaslDriver, registerWaslVehicle, vehicleWaslInput } from './waslSync.ts';
import type { WaslWireResult } from '../../src/domain/wasl.ts';

export interface OnboardingResult {
  tapDestinationId: string | null;
  tapStatus: 'created' | 'existing' | 'skipped' | 'failed';
  tapError: string | null;
  waslDriver: WaslWireResult | null;
  waslVehicle: WaslWireResult | null;
}

function str(value: unknown): string {
  return String(value || '').trim();
}

function readBank(data: Record<string, unknown> | undefined): {
  iban: string;
  bankName: string;
  accountHolderName: string;
} | null {
  const bank = (data?.bankDetails || {}) as Record<string, unknown>;
  const iban = normalizeIban(str(bank.iban));
  const bankName = str(bank.bankName);
  const accountHolderName = str(bank.accountHolderName || data?.fullName || data?.name || data?.companyName);
  if (!iban || !bankName) return null;
  return { iban, bankName, accountHolderName };
}

async function ensureDestination(
  secret: string,
  existingId: string,
  displayName: string,
  bank: { iban: string; bankName: string; accountHolderName: string } | null
): Promise<{ id: string | null; status: OnboardingResult['tapStatus']; error: string | null }> {
  if (existingId) return { id: existingId, status: 'existing', error: null };
  if (!bank) return { id: null, status: 'skipped', error: 'BANK_DETAILS_REQUIRED' };
  if (!secret) return { id: null, status: 'skipped', error: 'TAP_NOT_CONFIGURED' };
  try {
    const created = await createTapDestination(secret, {
      displayName: displayName || bank.accountHolderName || 'JZ Logistics payee',
      iban: bank.iban,
      bankName: bank.bankName,
      accountHolderName: bank.accountHolderName,
    });
    return { id: created.id, status: 'created', error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TAP_DESTINATION_FAILED';
    console.error('[payments] destination onboarding failed', { message });
    return { id: null, status: 'failed', error: message };
  }
}

/**
 * After admin document approval: open a Tap destination for the payout IBAN
 * and register the driver plus vehicle with WASL when the profile is complete.
 * External failures are stored on the profile and do not roll back approval.
 */
export async function onboardApprovedDriver(
  db: admin.firestore.Firestore,
  uid: string
): Promise<OnboardingResult> {
  const driverRef = db.collection('drivers').doc(uid);
  const driverSnap = await driverRef.get();
  const driver = (driverSnap.data() || {}) as Record<string, unknown>;
  const operatorId = str(driver.operatorId || driver.companyId);
  const secret = getServerConfig().tapSecretKey;

  let bankOwner: admin.firestore.DocumentReference = driverRef;
  let bankData = driver;
  let displayName = str(driver.fullName || driver.name);
  if (operatorId) {
    const operatorRef = db.collection('operators').doc(operatorId);
    const operatorSnap = await operatorRef.get();
    if (operatorSnap.exists) {
      bankOwner = operatorRef;
      bankData = operatorSnap.data() as Record<string, unknown>;
      displayName = str(bankData.companyName || bankData.contactName || displayName);
    }
  }

  const destination = await ensureDestination(
    secret,
    str(bankData.tapDestinationId),
    displayName,
    readBank(bankData)
  );
  if (destination.id && destination.status === 'created') {
    await bankOwner.set(
      {
        tapDestinationId: destination.id,
        tapDestinationStatus: 'created',
        tapDestinationError: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else if (destination.error) {
    await bankOwner.set(
      {
        tapDestinationStatus: destination.status,
        tapDestinationError: destination.error,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const waslDriver = await registerWaslDriver(driverWaslInput(driver));
  const waslVehicle = await registerWaslVehicle(vehicleWaslInput(driver));
  await driverRef.set(
    {
      ...(waslDriver.reference ? { waslDriverReference: waslDriver.reference } : {}),
      ...(waslVehicle.reference ? { waslVehicleReference: waslVehicle.reference } : {}),
      waslDriverStatus: waslDriver.ok ? 'registered' : waslDriver.skipped ? 'skipped' : 'failed',
      waslVehicleStatus: waslVehicle.ok ? 'registered' : waslVehicle.skipped ? 'skipped' : 'failed',
      waslDriverReason: waslDriver.reason || waslDriver.error || null,
      waslVehicleReason: waslVehicle.reason || waslVehicle.error || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    tapDestinationId: destination.id,
    tapStatus: destination.status,
    tapError: destination.error,
    waslDriver,
    waslVehicle,
  };
}

export async function onboardApprovedOperator(
  db: admin.firestore.Firestore,
  operatorId: string
): Promise<Pick<OnboardingResult, 'tapDestinationId' | 'tapStatus' | 'tapError'>> {
  const ref = db.collection('operators').doc(operatorId);
  const snap = await ref.get();
  const data = (snap.data() || {}) as Record<string, unknown>;
  const destination = await ensureDestination(
    getServerConfig().tapSecretKey,
    str(data.tapDestinationId),
    str(data.companyName || data.contactName),
    readBank(data)
  );
  await ref.set(
    {
      ...(destination.id && destination.status === 'created' ? { tapDestinationId: destination.id } : {}),
      tapDestinationStatus: destination.status,
      ...(destination.error
        ? { tapDestinationError: destination.error }
        : { tapDestinationError: admin.firestore.FieldValue.delete() }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return {
    tapDestinationId: destination.id,
    tapStatus: destination.status,
    tapError: destination.error,
  };
}

export async function registerApprovedFleetVehicle(
  db: admin.firestore.Firestore,
  operatorId: string,
  vehicleId: string
): Promise<WaslWireResult> {
  const ref = db.collection('operators').doc(operatorId).collection('vehicles').doc(vehicleId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, skipped: true, reason: 'VEHICLE_NOT_FOUND', reference: null };
  const result = await registerWaslVehicle(vehicleWaslInput(snap.data() as Record<string, unknown>));
  await ref.set(
    {
      ...(result.reference ? { waslVehicleReference: result.reference } : {}),
      waslVehicleStatus: result.ok ? 'registered' : result.skipped ? 'skipped' : 'failed',
      waslVehicleReason: result.reason || result.error || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return result;
}
