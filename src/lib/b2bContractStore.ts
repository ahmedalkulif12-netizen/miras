/**
 * Client-side mock store for B2B corporate contracts (marketplace / posting board).
 * Persists to localStorage so corporate posts appear for transport operators.
 * Replace with Firestore in a later backend step.
 */

export type ContractStatus = 'open' | 'applied' | 'accepted' | 'closed';

export interface FleetContract {
  id: string;
  corporateId: string;
  corporateName: string;
  title: string;
  transportType: string;
  duration: string;
  /** Full budget entered by the corporate client (admin / corporate only). */
  originalBudget: number;
  /** Budget shown to transport companies after platform margin. */
  operatorVisibleBudget: number;
  status: ContractStatus;
  createdAt: string;
  hasDocument?: boolean;
  documentName?: string;
  documentKind?: 'pdf' | 'image';
  /** Operator who applied / accepted this contract */
  applicantId?: string;
  applicantName?: string;
  appliedAt?: string;
}

export interface FleetVehicle {
  id: string;
  operatorId: string;
  plateNumber: string;
  /** Display label e.g. "السطحات — سطحة هيدروليك" */
  type: string;
  /** Canonical service type: furniture_moving | flatbed | … */
  category?: string;
  /** Canonical tier/option: hydraulic | van | 1000L | … */
  subtype?: string;
  /** Alias of category — used for order↔fleet matching */
  serviceType?: string;
  /** Alias of subtype — used for order↔fleet matching */
  serviceOption?: string;
  /** Manufacturer / model e.g. "Isuzu NPR" */
  model?: string;
  /** Model year */
  year?: string;
  driverName: string;
  status: 'available' | 'on_contract' | 'maintenance';
  accountStatus?: 'pending' | 'pending_review' | 'ready_for_review' | 'approved' | 'rejected';
  documents?: Partial<
    Record<
      'license' | 'id' | 'registration' | 'permit',
      { status?: string; storagePath?: string; url?: string; fileName?: string }
    >
  >;
  createdAt?: string;
  updatedAt?: string;
}

const CONTRACTS_KEY = 'miras_b2b_contracts_v2';
const LEGACY_CONTRACTS_KEY = 'hamula_b2b_contracts_v2';
const FLEET_KEY = 'miras_b2b_fleet';
const LEGACY_FLEET_KEY = 'hamula_b2b_fleet';

/** Platform margin deducted from budget before transport companies see it (10%). */
export const PLATFORM_MARGIN_RATE = 0.1;

export function applyPlatformMargin(originalBudget: number): number {
  return Math.round(originalBudget * (1 - PLATFORM_MARGIN_RATE));
}

const SEED_CONTRACTS: FleetContract[] = [
  {
    id: 'ctr-seed-1',
    corporateId: 'seed-corp',
    corporateName: 'Al-Riyadh Logistics Co.',
    title: 'Riyadh–Jeddah Refrigerated Fleet',
    transportType: 'Refrigerated',
    duration: '12 months',
    originalBudget: 480_000,
    operatorVisibleBudget: applyPlatformMargin(480_000),
    status: 'open',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    hasDocument: true,
    documentName: 'riyadh-jeddah-contract.pdf',
    documentKind: 'pdf',
  },
  {
    id: 'ctr-seed-2',
    corporateId: 'seed-corp-2',
    corporateName: 'Eastern Cement Industries',
    title: 'Dammam Bulk Cement Haulage',
    transportType: 'Bulk Cargo',
    duration: '6 months',
    originalBudget: 320_000,
    operatorVisibleBudget: applyPlatformMargin(320_000),
    status: 'accepted',
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    hasDocument: true,
    documentName: 'eastern-cement.pdf',
    documentKind: 'pdf',
    applicantId: 'seed-op',
    applicantName: 'Gulf Fleet Partners',
    appliedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: 'ctr-seed-3',
    corporateId: 'seed-corp-3',
    corporateName: 'Tabuk Agricultural Export',
    title: 'Tabuk Fresh Produce Shuttle',
    transportType: 'Fresh Produce',
    duration: '3 months',
    originalBudget: 185_000,
    operatorVisibleBudget: applyPlatformMargin(185_000),
    status: 'closed',
    createdAt: new Date(Date.now() - 86400000 * 90).toISOString(),
    hasDocument: true,
    documentName: 'tabuk-produce.jpg',
    documentKind: 'image',
  },
];

const SEED_FLEET: FleetVehicle[] = [
  {
    id: 'veh-1',
    operatorId: 'default',
    plateNumber: 'ABC 4521',
    type: 'Flatbed — 24T',
    driverName: 'Mohammed Al-Otaibi',
    status: 'available',
  },
  {
    id: 'veh-2',
    operatorId: 'default',
    plateNumber: 'XYZ 8834',
    type: 'Refrigerated — 18T',
    driverName: 'Fahad Al-Qahtani',
    status: 'on_contract',
  },
  {
    id: 'veh-3',
    operatorId: 'default',
    plateNumber: 'KSA 1190',
    type: 'Heavy Haul — 40T',
    driverName: 'Salem Al-Dossari',
    status: 'maintenance',
  },
];

/** Read-only samples for empty corporate dashboards (screenshots / demos). */
export const SAMPLE_CONTRACTS: FleetContract[] = SEED_CONTRACTS;

function readJson<T>(key: string, legacyKey: string, fallback: T): T {
  try {
    let raw = localStorage.getItem(key);
    if (!raw) {
      raw = localStorage.getItem(legacyKey);
      if (raw) {
        localStorage.setItem(key, raw);
        localStorage.removeItem(legacyKey);
      }
    }
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureSeeded(): FleetContract[] {
  const existing = readJson<FleetContract[]>(CONTRACTS_KEY, LEGACY_CONTRACTS_KEY, []);
  if (existing.length === 0) {
    writeJson(CONTRACTS_KEY, SEED_CONTRACTS);
    return SEED_CONTRACTS;
  }
  return existing;
}

export function getContracts(): FleetContract[] {
  return ensureSeeded().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getContractsForCorporate(corporateId: string): FleetContract[] {
  return getContracts().filter((c) => c.corporateId === corporateId);
}

/** Contracts available for transport companies to apply to. */
export function getOpenContracts(): FleetContract[] {
  return getContracts().filter((c) => c.status === 'open');
}

export type CreateContractInput = {
  corporateId: string;
  corporateName: string;
  title: string;
  transportType: string;
  duration: string;
  originalBudget: number;
  hasDocument?: boolean;
  documentName?: string;
  documentKind?: 'pdf' | 'image';
};

export function createContract(input: CreateContractInput): FleetContract {
  const contracts = getContracts();
  const contract: FleetContract = {
    ...input,
    id: `ctr-${Date.now()}`,
    status: 'open',
    createdAt: new Date().toISOString(),
    operatorVisibleBudget: applyPlatformMargin(input.originalBudget),
  };
  writeJson(CONTRACTS_KEY, [contract, ...contracts]);
  return contract;
}

export function hasOperatorApplied(contractId: string, operatorId: string): boolean {
  const contract = getContracts().find((c) => c.id === contractId);
  return Boolean(contract?.applicantId && contract.applicantId === operatorId);
}

/**
 * Transport company applies / accepts an open contract.
 * Marks the contract as accepted and records the operator.
 */
export function applyToContract(
  contractId: string,
  operatorId: string,
  operatorName: string
): FleetContract | null {
  const contracts = getContracts();
  const target = contracts.find((c) => c.id === contractId);
  if (!target || target.status !== 'open') return null;
  if (target.applicantId) return null;

  const updated: FleetContract = {
    ...target,
    status: 'accepted',
    applicantId: operatorId,
    applicantName: operatorName,
    appliedAt: new Date().toISOString(),
  };

  writeJson(
    CONTRACTS_KEY,
    contracts.map((c) => (c.id === contractId ? updated : c))
  );
  return updated;
}

export function getFleetForOperator(operatorId: string): FleetVehicle[] {
  const stored = readJson<FleetVehicle[]>(FLEET_KEY, LEGACY_FLEET_KEY, []);
  const mine = stored.filter((v) => v.operatorId === operatorId);
  if (mine.length > 0) return mine;

  if (stored.length === 0) {
    const seeded = SEED_FLEET.map((v) => ({
      ...v,
      operatorId,
      createdAt: new Date().toISOString(),
    }));
    writeJson(FLEET_KEY, seeded);
    return seeded;
  }

  // Legacy demo rows tagged operatorId === 'default'
  return stored.filter((v) => v.operatorId === 'default');
}

export type AddFleetVehicleInput = {
  operatorId: string;
  plateNumber: string;
  type: string;
  category?: string;
  subtype?: string;
  serviceType?: string;
  serviceOption?: string;
  model?: string;
  year?: string;
  driverName?: string;
  status?: FleetVehicle['status'];
  accountStatus?: FleetVehicle['accountStatus'];
  documents?: FleetVehicle['documents'];
};

const DEMO_SEED_IDS = new Set(['veh-1', 'veh-2', 'veh-3']);

/** Persist a new vehicle locally (also used as optimistic cache alongside Firestore). */
export function addFleetVehicle(input: AddFleetVehicleInput & { id?: string }): FleetVehicle {
  const all = readJson<FleetVehicle[]>(FLEET_KEY, LEGACY_FLEET_KEY, []);
  const now = new Date().toISOString();
  const serviceType = input.serviceType || input.category;
  const serviceOption = input.serviceOption || input.subtype;
  const vehicle: FleetVehicle = {
    id: input.id || `veh-${Date.now()}`,
    operatorId: input.operatorId,
    plateNumber: input.plateNumber.trim().toUpperCase(),
    type: input.type.trim(),
    category: serviceType,
    subtype: serviceOption,
    serviceType,
    serviceOption,
    model: input.model?.trim() || undefined,
    year: input.year?.trim() || undefined,
    driverName: (input.driverName || '').trim() || '—',
    status: input.status || 'available',
    accountStatus: input.accountStatus || 'pending',
    documents: input.documents,
    createdAt: now,
    updatedAt: now,
  };

  // Drop demo seeds once a real vehicle is added for this operator.
  const cleaned = all.filter(
    (v) =>
      v.id !== vehicle.id &&
      v.operatorId !== 'default' &&
      !(v.operatorId === input.operatorId && DEMO_SEED_IDS.has(v.id))
  );
  writeJson(FLEET_KEY, [...cleaned, vehicle]);
  return vehicle;
}

/** Replace operator fleet cache (e.g. after Firestore load). */
export function replaceOperatorFleetCache(
  operatorId: string,
  vehicles: FleetVehicle[]
): void {
  const all = readJson<FleetVehicle[]>(FLEET_KEY, LEGACY_FLEET_KEY, []);
  const others = all.filter(
    (v) => v.operatorId !== operatorId && v.operatorId !== 'default'
  );
  writeJson(FLEET_KEY, [...others, ...vehicles]);
}
