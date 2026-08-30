import admin from 'firebase-admin';
import { isTestOrGhostRecord } from './testDataPatterns.ts';

export type DirectoryKind =
  | 'b2c_client'
  | 'b2c_driver'
  | 'b2b_corporate'
  | 'b2b_operator'
  | 'fleet_driver';

export type DirectorySegment = 'b2c' | 'b2b';

export interface AdminDirectoryEntry {
  id: string;
  kind: DirectoryKind;
  segment: DirectorySegment;
  roleLabelEn: string;
  roleLabelAr: string;
  name: string;
  phone: string;
  status: string;
  companyName?: string;
  commercialRegistration?: string;
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  nationalId?: string;
  registrationSerial?: string;
  operatorId?: string;
  operatorName?: string;
  createdAt?: string | null;
}

export interface AdminDirectoryResult {
  stats: {
    totalUsers: number;
    totalDrivers: number;
    totalIndividualDrivers: number;
    totalFleetDrivers: number;
    totalClients: number;
    totalCorporate: number;
    totalOperators: number;
  };
  entries: AdminDirectoryEntry[];
}

const KIND_META: Record<DirectoryKind, { segment: DirectorySegment; en: string; ar: string }> = {
  b2c_client: { segment: 'b2c', en: 'Individual Client', ar: 'عميل فردي' },
  b2c_driver: { segment: 'b2c', en: 'Individual Driver', ar: 'سائق فردي' },
  b2b_corporate: { segment: 'b2b', en: 'Corporate Client', ar: 'عميل شركات' },
  b2b_operator: { segment: 'b2b', en: 'Fleet Operator', ar: 'مشغل أسطول' },
  fleet_driver: { segment: 'b2b', en: 'Fleet Driver', ar: 'سائق أسطول' },
};

function tsToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function kindFromRole(role: unknown): DirectoryKind | null {
  const value = String(role || '');
  if (value === 'b2c_client' || value === 'customer') return 'b2c_client';
  if (value === 'b2c_driver' || value === 'driver') return 'b2c_driver';
  if (value === 'b2b_corporate' || value === 'corporate') return 'b2b_corporate';
  if (value === 'b2b_operator' || value === 'operator') return 'b2b_operator';
  return null;
}

function entryFromDocs(
  id: string,
  kind: DirectoryKind,
  user: Record<string, unknown>,
  companion: Record<string, unknown>
): AdminDirectoryEntry | null {
  const name = String(
    companion.fullName || companion.contactName || user.name || companion.name || ''
  ).trim();
  const phone = String(user.phone || companion.phone || '');
  if (
    isTestOrGhostRecord({
      uid: id,
      phone,
      name,
      fullName: companion.fullName,
      companyName: companion.companyName || user.companyName,
      plateNumber: companion.plateNumber || user.plateNumber,
    })
  ) {
    return null;
  }

  const meta = KIND_META[kind];
  return {
    id,
    kind,
    segment: meta.segment,
    roleLabelEn: meta.en,
    roleLabelAr: meta.ar,
    name: name || meta.en,
    phone,
    status: String(companion.accountStatus || user.accountStatus || 'active'),
    companyName: companion.companyName
      ? String(companion.companyName)
      : user.companyName
        ? String(user.companyName)
        : undefined,
    commercialRegistration: companion.commercialRegistration
      ? String(companion.commercialRegistration)
      : user.commercialRegistration
        ? String(user.commercialRegistration)
        : undefined,
    vehicleType: String(companion.vehicleType || user.vehicleType || '') || undefined,
    vehicleOption: String(
      companion.vehicleSize || companion.vehicleOption || user.vehicleOption || ''
    ) || undefined,
    plateNumber: String(companion.plateNumber || user.plateNumber || '') || undefined,
    nationalId: companion.nationalId
      ? String(companion.nationalId)
      : user.nationalId
        ? String(user.nationalId)
        : undefined,
    registrationSerial: companion.registrationSerial
      ? String(companion.registrationSerial)
      : undefined,
    createdAt: tsToIso(companion.createdAt || user.createdAt),
  };
}

async function loadCollectionMap(
  db: admin.firestore.Firestore,
  name: string
): Promise<Map<string, Record<string, unknown>>> {
  const snap = await db.collection(name).limit(500).get();
  const map = new Map<string, Record<string, unknown>>();
  snap.docs.forEach((doc) => {
    map.set(doc.id, doc.data() as Record<string, unknown>);
  });
  return map;
}

/** Production directory of real B2C/B2B registrations (test/ghost rows omitted). */
export async function listAdminDirectory(
  db: admin.firestore.Firestore,
  kindFilter?: DirectoryKind | 'all'
): Promise<AdminDirectoryResult> {
  const [usersSnap, customers, drivers, corporates, operators] = await Promise.all([
    db.collection('users').limit(500).get(),
    loadCollectionMap(db, 'customers'),
    loadCollectionMap(db, 'drivers'),
    loadCollectionMap(db, 'corporates'),
    loadCollectionMap(db, 'operators'),
  ]);

  const byId = new Map<string, AdminDirectoryEntry>();

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data() as Record<string, unknown>;
    if (String(user.accountStatus || '') === 'deleted') continue;
    const kind = kindFromRole(user.role);
    if (!kind) continue;

    const companion =
      kind === 'b2c_client'
        ? customers.get(userDoc.id) || {}
        : kind === 'b2c_driver'
          ? drivers.get(userDoc.id) || {}
          : kind === 'b2b_corporate'
            ? corporates.get(userDoc.id) || {}
            : operators.get(userDoc.id) || {};

    const entry = entryFromDocs(userDoc.id, kind, user, companion);
    if (entry) byId.set(userDoc.id, entry);
  }

  // Companion-only registrations (users/{uid} missing but profile exists).
  const companionSets: Array<{ map: Map<string, Record<string, unknown>>; kind: DirectoryKind }> = [
    { map: customers, kind: 'b2c_client' },
    { map: drivers, kind: 'b2c_driver' },
    { map: corporates, kind: 'b2b_corporate' },
    { map: operators, kind: 'b2b_operator' },
  ];
  for (const { map, kind } of companionSets) {
    for (const [id, companion] of map.entries()) {
      if (byId.has(id)) continue;
      const entry = entryFromDocs(id, kind, {}, companion);
      if (entry) byId.set(id, entry);
    }
  }

  const fleetEntries: AdminDirectoryEntry[] = [];
  await Promise.all(
    Array.from(operators.entries()).map(async ([operatorId, operator]) => {
      const vehiclesSnap = await db.collection('operators').doc(operatorId).collection('vehicles').limit(200).get();
      const operatorName = String(operator.companyName || operator.contactName || operator.name || 'Operator');
      for (const vehicleDoc of vehiclesSnap.docs) {
        const vehicle = vehicleDoc.data() as Record<string, unknown>;
        const driverName = String(vehicle.driverName || '').trim();
        const plate = String(vehicle.plateNumber || '');
        if (
          isTestOrGhostRecord({
            uid: vehicleDoc.id,
            name: driverName,
            plateNumber: plate,
            companyName: operatorName,
          })
        ) {
          continue;
        }
        if (!driverName && !plate) continue;
        const meta = KIND_META.fleet_driver;
        fleetEntries.push({
          id: `${operatorId}:${vehicleDoc.id}`,
          kind: 'fleet_driver',
          segment: meta.segment,
          roleLabelEn: meta.en,
          roleLabelAr: meta.ar,
          name: driverName || plate || meta.en,
          phone: String(vehicle.phone || operator.phone || ''),
          status: String(vehicle.accountStatus || vehicle.status || 'available'),
          companyName: operatorName,
          vehicleType: String(vehicle.serviceType || vehicle.type || vehicle.category || '') || undefined,
          vehicleOption: String(vehicle.serviceOption || vehicle.subtype || '') || undefined,
          plateNumber: plate || undefined,
          operatorId,
          operatorName,
          createdAt: tsToIso(vehicle.createdAt),
        });
      }
    })
  );

  let entries = [...byId.values(), ...fleetEntries];
  if (kindFilter && kindFilter !== 'all') {
    entries = entries.filter((row) => row.kind === kindFilter);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const accountEntries = [...byId.values()];
  const stats = {
    totalUsers: accountEntries.length,
    totalIndividualDrivers: accountEntries.filter((e) => e.kind === 'b2c_driver').length,
    totalFleetDrivers: fleetEntries.length,
    totalClients: accountEntries.filter((e) => e.kind === 'b2c_client').length,
    totalCorporate: accountEntries.filter((e) => e.kind === 'b2b_corporate').length,
    totalOperators: accountEntries.filter((e) => e.kind === 'b2b_operator').length,
    totalDrivers: 0,
  };
  stats.totalDrivers = stats.totalIndividualDrivers + stats.totalFleetDrivers;

  return { stats, entries };
}

export async function getAdminDirectoryEntry(
  db: admin.firestore.Firestore,
  id: string
): Promise<AdminDirectoryEntry | null> {
  const { entries } = await listAdminDirectory(db);
  return entries.find((row) => row.id === id) || null;
}
