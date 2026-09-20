import { authFetch, isDevBypassAuthSession } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { ensureAdminApiReady } from '@/lib/adminAuth';
import { persistCurrentIdToken, ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import {
  adminOverviewRetryDelayMs,
  emptyAdminOverviewResponse,
  isRetryableAdminOverviewStatus,
  persistAdminOverviewCache,
  readAdminOverviewCache,
} from '@/lib/adminOverviewCache';
import type { DriverAccountStatus } from '@/types';

async function adminAuthedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    if (attempt > 0) {
      await sleep(adminOverviewRetryDelayMs(attempt - 1));
      try {
        await persistCurrentIdToken(true);
      } catch (error) {
        console.warn('[admin] token refresh before retry failed:', error);
      }
    }
    await ensureAdminApiReady();
    last = await authFetch(path, init);
    if (last.ok) return last;
    if (!isRetryableAdminOverviewStatus(last.status)) return last;
    console.warn('[admin] unauthorized/retryable — re-establishing session', path, last.status, attempt);
  }
  return last as Response;
}

export { adminAuthedFetch };

export type CustomerAccountStatus = 'active' | 'blocked' | 'banned' | 'pending' | 'suspended';

export interface AdminOverviewResponse {
  stats: {
    activeDrivers: number;
    pendingDrivers: number;
    totalUsers?: number;
    totalDrivers?: number;
    totalIndividualDrivers?: number;
    totalFleetDrivers?: number;
    totalClients?: number;
    totalCorporate?: number;
    totalOperators?: number;
    activeTrips: number;
    completedOrders: number;
    openOrders?: number;
    netRevenueSar: number;
    clientPaymentsSar?: number;
    driverEarningsSar?: number;
    platformCommissionSar?: number;
  };
  recentOrders: Array<{
    id: string;
    kind?: 'order' | 'driver_registration';
    userId: string;
    customerName?: string | null;
    serviceType: string;
    amount: number;
    status: string;
    waterType?: string | null;
    capacity?: string | null;
    serviceOption?: string | null;
    vehicleFieldNotes?: Record<string, unknown> | null;
    createdAt?: string | null;
  }>;
  serviceDistribution?: Array<{
    serviceType: string;
    count: number;
    percentage: number;
  }>;
}

export interface AdminDriverDocumentMeta {
  status: 'not_uploaded' | 'uploaded';
  expiresAt?: string | null;
  storagePath?: string | null;
  contentType?: string | null;
  fileName?: string | null;
  viewable?: boolean;
}

export interface AdminDriverApiRow {
  id: string;
  kind?: 'b2c_driver' | 'fleet_driver';
  name: string;
  phone: string;
  truck: string;
  serviceType: string;
  subtype: string;
  plateNumber: string;
  nationalId?: string;
  registrationSerial?: string;
  companyName?: string;
  operatorId?: string;
  vehicleId?: string;
  status: DriverAccountStatus;
  docsComplete?: boolean;
  rejectionReason?: string | null;
  complaints: number;
  createdAt?: string | null;
  documents: {
    license: AdminDriverDocumentMeta;
    id: AdminDriverDocumentMeta;
    registration: AdminDriverDocumentMeta;
    permit: AdminDriverDocumentMeta;
  };
}

export interface AdminCustomerApiRow {
  id: string;
  name: string;
  phone: string;
  status: CustomerAccountStatus;
  ordersCount: number;
  totalSpentSar: number;
}

export type AdminDirectoryKind =
  | 'b2c_client'
  | 'b2c_driver'
  | 'b2b_corporate'
  | 'b2b_operator'
  | 'fleet_driver';

export interface AdminDirectoryEntry {
  id: string;
  kind: AdminDirectoryKind;
  segment: 'b2c' | 'b2b';
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

export interface AdminDirectoryResponse {
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

export interface AdminFinancialLedgerResponse {
  summary: {
    currency: 'SAR';
    completedOrders: number;
    clientPaymentsTotal: number;
    driverEarningsTotal: number;
    platformCommissionTotal: number;
    serviceFeesTotal: number;
    tripFareTotal: number;
  };
  recentEntries: Array<{
    orderId: string;
    userId: string;
    driverId: string;
    serviceType: string;
    status: string;
    clientPayment: number;
    driverNet: number;
    platformFee: number;
    serviceFee: number;
    tripFare: number;
    createdAt: string | null;
  }>;
}

function buildDevAdminOverview(): AdminOverviewResponse {
  return emptyAdminOverviewResponse();
}

function buildDevAdminDrivers(): AdminDriverApiRow[] {
  return [];
}

function buildDevAdminCustomers(): AdminCustomerApiRow[] {
  return [];
}

function buildDevAdminFinancials(): AdminFinancialLedgerResponse {
  return {
    summary: {
      currency: 'SAR',
      completedOrders: 0,
      clientPaymentsTotal: 0,
      driverEarningsTotal: 0,
      platformCommissionTotal: 0,
      serviceFeesTotal: 0,
      tripFareTotal: 0,
    },
    recentEntries: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminOverview();
  }

  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(adminOverviewRetryDelayMs(attempt - 1));
        try {
          await ensureSignedInFirebaseUid(12_000);
          await persistCurrentIdToken(true);
        } catch (tokenError) {
          console.warn('[admin] waiting for Firebase ID token before overview retry:', tokenError);
        }
      }

      await ensureAdminApiReady();
      const res = await adminAuthedFetch('/api/admin/overview');
      if (res.ok) {
        const data = await readApiJson<AdminOverviewResponse>(res);
        persistAdminOverviewCache(data);
        return data;
      }

      lastError = new Error(await readApiErrorMessage(res, 'Failed to load admin overview'));
      if (!isRetryableAdminOverviewStatus(res.status) && attempt >= 1) {
        break;
      }
      console.warn(
        `[admin] overview ${res.status} — retry ${attempt + 1}/${maxRetries}`,
        lastError instanceof Error ? lastError.message : lastError
      );
    } catch (error) {
      lastError = error;
      console.warn('[admin] overview fetch failed — will retry after token wait:', error);
    }
  }

  const cached = readAdminOverviewCache();
  if (cached) {
    console.warn('[admin] overview using stale cache after retries', lastError);
    return cached;
  }

  console.warn('[admin] overview falling back to empty summary after retries', lastError);
  return emptyAdminOverviewResponse();
}

export async function fetchAdminDrivers(): Promise<AdminDriverApiRow[]> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminDrivers();
  }
  const res = await adminAuthedFetch('/api/admin/drivers');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load drivers'));
  }
  const data = await readApiJson<AdminDriverApiRow[] | { drivers?: AdminDriverApiRow[] | null }>(
    res
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data.drivers) ? data.drivers : [];
}

export async function fetchAdminDriverDocumentUrl(
  driver: {
    id: string;
    kind?: 'b2c_driver' | 'fleet_driver';
    operatorId?: string;
    vehicleId?: string;
  },
  docKey: 'license' | 'id' | 'registration' | 'permit'
): Promise<{ url: string; contentType: string; fileName: string }> {
  if (isDevBypassAuthSession()) {
    throw new Error('Document viewing unavailable in dev bypass mode');
  }
  const path =
    driver.kind === 'fleet_driver' && driver.operatorId && driver.vehicleId
      ? `/api/admin/operators/${encodeURIComponent(driver.operatorId)}/vehicles/${encodeURIComponent(driver.vehicleId)}/documents/${docKey}/url`
      : `/api/admin/drivers/${encodeURIComponent(driver.id)}/documents/${docKey}/url`;
  const res = await adminAuthedFetch(path);
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to open document'));
  }
  return readApiJson<{ url: string; contentType: string; fileName: string }>(res);
}

export async function updateAdminDriverStatusApi(
  driver: {
    id: string;
    kind?: 'b2c_driver' | 'fleet_driver';
    operatorId?: string;
    vehicleId?: string;
  },
  status: DriverAccountStatus,
  reason?: string
): Promise<void> {
  if (isDevBypassAuthSession()) {
    console.info('[admin] Dev bypass — mock driver status', driver.id, status, reason);
    return;
  }
  const path =
    driver.kind === 'fleet_driver' && driver.operatorId && driver.vehicleId
      ? `/api/admin/operators/${encodeURIComponent(driver.operatorId)}/vehicles/${encodeURIComponent(driver.vehicleId)}/status`
      : `/api/admin/drivers/${encodeURIComponent(driver.id)}/status`;
  const res = await adminAuthedFetch(path, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to update driver status'));
  }
}

export async function updateAdminDriverDocumentExpiriesApi(
  driverId: string,
  documentExpiries: Record<string, string>
): Promise<void> {
  if (isDevBypassAuthSession()) {
    console.info('[admin] Dev bypass — mock document expiries', driverId, documentExpiries);
    return;
  }
  const res = await adminAuthedFetch(`/api/admin/drivers/${driverId}/document-expiries`, {
    method: 'PATCH',
    body: JSON.stringify({ documentExpiries }),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to update document expiries'));
  }
}

export async function fetchAdminCustomers(): Promise<AdminCustomerApiRow[]> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminCustomers();
  }
  const res = await adminAuthedFetch('/api/admin/customers');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load customers'));
  }
  const data = await readApiJson<{ customers: AdminCustomerApiRow[] }>(res);
  return data.customers;
}

export async function updateAdminCustomerStatusApi(
  customerId: string,
  status: CustomerAccountStatus
): Promise<void> {
  if (isDevBypassAuthSession()) {
    console.info('[admin] Dev bypass — mock customer status', customerId, status);
    return;
  }
  const res = await adminAuthedFetch(`/api/admin/customers/${customerId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to update customer status'));
  }
}

export async function fetchAdminDirectory(
  kind: AdminDirectoryKind | 'all' = 'all'
): Promise<AdminDirectoryResponse> {
  if (isDevBypassAuthSession()) {
    return {
      stats: {
        totalUsers: 0,
        totalDrivers: 0,
        totalIndividualDrivers: 0,
        totalFleetDrivers: 0,
        totalClients: 0,
        totalCorporate: 0,
        totalOperators: 0,
      },
      entries: [],
    };
  }
  const params = kind && kind !== 'all' ? `?kind=${encodeURIComponent(kind)}` : '';
  const res = await adminAuthedFetch(`/api/admin/directory${params}`);
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load user directory'));
  }
  return readApiJson<AdminDirectoryResponse>(res);
}

export async function fetchAdminFinancials(): Promise<AdminFinancialLedgerResponse> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminFinancials();
  }
  const res = await adminAuthedFetch('/api/admin/financials');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load financial ledger'));
  }
  return readApiJson<AdminFinancialLedgerResponse>(res);
}
