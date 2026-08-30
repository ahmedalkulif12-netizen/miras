/**
 * Fleet vehicles for B2B operators.
 * Primary store: operators/{operatorId}/vehicles/{vehicleId}
 * Local cache: b2bContractStore (offline / demo fallback)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import {
  addFleetVehicle,
  replaceOperatorFleetCache,
  type AddFleetVehicleInput,
  type FleetVehicle,
} from '@/lib/b2bContractStore';

function toFleetVehicle(
  operatorId: string,
  id: string,
  data: Record<string, unknown>
): FleetVehicle {
  const serviceTypeRaw = data.serviceType ?? data.category;
  const serviceOptionRaw = data.serviceOption ?? data.subtype;
  const serviceType =
    serviceTypeRaw != null && String(serviceTypeRaw).trim()
      ? String(serviceTypeRaw)
      : undefined;
  const serviceOption =
    serviceOptionRaw != null && String(serviceOptionRaw).trim()
      ? String(serviceOptionRaw)
      : undefined;

  return {
    id,
    operatorId,
    plateNumber: String(data.plateNumber || ''),
    type: String(data.type || serviceType || ''),
    category: serviceType,
    subtype: serviceOption,
    serviceType,
    serviceOption,
    model: data.model ? String(data.model) : undefined,
    year: data.year ? String(data.year) : undefined,
    driverName: String(data.driverName || '—'),
    status: (data.status as FleetVehicle['status']) || 'available',
    accountStatus:
      (data.accountStatus as FleetVehicle['accountStatus']) || 'ready_for_review',
    documents: (data.documents as FleetVehicle['documents']) || undefined,
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : data.createdAt &&
            typeof (data.createdAt as { toDate?: () => Date }).toDate === 'function'
          ? (data.createdAt as { toDate: () => Date }).toDate().toISOString()
          : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

/** Load vehicles from Firestore; returns [] on failure (caller may use local cache). */
export async function listOperatorVehicles(
  operatorId: string
): Promise<FleetVehicle[]> {
  try {
    try {
      await ensureSignedInFirebaseUid(8000);
    } catch {
      await ensureFirebaseReady();
    }
    const snap = await getDocs(collection(db, 'operators', operatorId, 'vehicles'));
    const vehicles = snap.docs.map((d) =>
      toFleetVehicle(operatorId, d.id, d.data() as Record<string, unknown>)
    );
    if (vehicles.length > 0) {
      replaceOperatorFleetCache(operatorId, vehicles);
    }
    return vehicles;
  } catch (err) {
    console.warn('[fleetVehicleService] list failed, using local cache:', err);
    return [];
  }
}

export type CreateOperatorVehicleInput = AddFleetVehicleInput;

/**
 * Create a vehicle under operators/{uid}/vehicles/{id}, bump fleetSize,
 * update fleetCapacity for matching, and mirror to localStorage.
 */
export async function createOperatorVehicle(
  input: CreateOperatorVehicleInput
): Promise<{ vehicle: FleetVehicle; cloudSynced: boolean }> {
  const id = `veh-${Date.now()}`;
  const vehicle = addFleetVehicle({ ...input, id });
  const serviceType = vehicle.serviceType || vehicle.category;
  const serviceOption = vehicle.serviceOption || vehicle.subtype;

  try {
    try {
      await ensureSignedInFirebaseUid(8000);
    } catch {
      await ensureFirebaseReady();
    }
    const vehicleRef = doc(db, 'operators', input.operatorId, 'vehicles', id);
    const operatorRef = doc(db, 'operators', input.operatorId);

    await setDoc(vehicleRef, {
      operatorId: input.operatorId,
      plateNumber: vehicle.plateNumber,
      type: vehicle.type,
      // Matching keys (canonical 6-service taxonomy)
      serviceType: serviceType || null,
      serviceOption: serviceOption || null,
      // Aliases kept for older readers
      category: serviceType || null,
      subtype: serviceOption || null,
      model: vehicle.model || null,
      year: vehicle.year || null,
      driverName: vehicle.driverName,
      status: vehicle.status,
      accountStatus: vehicle.accountStatus || 'ready_for_review',
      documents: vehicle.documents || {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const existing = await getDoc(operatorRef);
    const prevCapacity =
      (existing.exists() &&
        (existing.data()?.fleetCapacity as Record<string, string[]> | undefined)) ||
      {};
    const nextCapacity = { ...prevCapacity };
    if (serviceType && serviceOption) {
      const tiers = Array.isArray(nextCapacity[serviceType])
        ? [...nextCapacity[serviceType]]
        : [];
      if (!tiers.includes(serviceOption)) tiers.push(serviceOption);
      nextCapacity[serviceType] = tiers;
    }

    await setDoc(
      operatorRef,
      {
        uid: input.operatorId,
        fleetSize: increment(1),
        fleetCapacity: nextCapacity,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { vehicle, cloudSynced: true };
  } catch (err) {
    console.error('[fleetVehicleService] Firestore sync failed (kept local):', err);
    return { vehicle, cloudSynced: false };
  }
}
