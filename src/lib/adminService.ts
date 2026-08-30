import { authFetch, isDevBypassAuthSession } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import type { DriverAccountStatus } from '@/types';

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

/** Sample admin dashboard data for localhost developer bypass (no Firebase token). */
function buildDevAdminOverview(): AdminOverviewResponse {
  return {
    stats: {
      activeDrivers: 0,
      pendingDrivers: 0,
      totalUsers: 0,
      totalDrivers: 0,
      totalIndividualDrivers: 0,
      totalFleetDrivers: 0,
      totalClients: 0,
      totalCorporate: 0,
      totalOperators: 0,
      activeTrips: 0,
      completedOrders: 0,
      openOrders: 0,
      netRevenueSar: 0,
      clientPaymentsSar: 0,
      driverEarningsSar: 0,
      platformCommissionSar: 0,
    },
    recentOrders: [],
  };
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

export async function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminOverview();
  }
  const res = await authFetch('/api/admin/overview');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load admin overview'));
  }
  return readApiJson<AdminOverviewResponse>(res);
}

export async function fetchAdminDrivers(): Promise<AdminDriverApiRow[]> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminDrivers();
  }
  const res = await authFetch('/api/admin/drivers');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load drivers'));
  }
  const data = await readApiJson<{ drivers: AdminDriverApiRow[] }>(res);
  return data.drivers;
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
  const res = await authFetch(path);
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
  const res = await authFetch(path, {
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
  const res = await authFetch(`/api/admin/drivers/${driverId}/document-expiries`, {
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
  const res = await authFetch('/api/admin/customers');
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
  const res = await authFetch(`/api/admin/customers/${customerId}/status`, {
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
  const res = await authFetch(`/api/admin/directory${params}`);
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load user directory'));
  }
  return readApiJson<AdminDirectoryResponse>(res);
}

export async function fetchAdminFinancials(): Promise<AdminFinancialLedgerResponse> {
  if (isDevBypassAuthSession()) {
    return buildDevAdminFinancials();
  }
  const res = await authFetch('/api/admin/financials');
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'Failed to load financial ledger'));
  }
  return readApiJson<AdminFinancialLedgerResponse>(res);
}
