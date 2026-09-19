import type { AdminOverviewResponse } from './adminService';

export const ADMIN_OVERVIEW_CACHE_KEY = 'miras_admin_overview_v1';
export const ADMIN_OVERVIEW_RETRY_DELAYS_MS = [400, 800, 1600] as const;

export interface AdminOverviewCacheEnvelope {
  savedAt: number;
  data: AdminOverviewResponse;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isRetryableAdminOverviewStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function adminOverviewRetryDelayMs(retryIndex: number): number {
  const delays = ADMIN_OVERVIEW_RETRY_DELAYS_MS;
  if (retryIndex < 0) return delays[0];
  return delays[Math.min(retryIndex, delays.length - 1)];
}

export function emptyAdminOverviewResponse(): AdminOverviewResponse {
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
    serviceDistribution: [],
  };
}

export function isAdminOverviewResponse(value: unknown): value is AdminOverviewResponse {
  if (!value || typeof value !== 'object') return false;
  const stats = (value as AdminOverviewResponse).stats;
  if (!stats || typeof stats !== 'object') return false;
  return (
    isFiniteNumber(stats.activeDrivers) &&
    isFiniteNumber(stats.pendingDrivers) &&
    isFiniteNumber(stats.activeTrips) &&
    isFiniteNumber(stats.completedOrders) &&
    isFiniteNumber(stats.netRevenueSar) &&
    Array.isArray((value as AdminOverviewResponse).recentOrders)
  );
}

export function parseAdminOverviewCache(raw: string | null | undefined): AdminOverviewResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminOverviewCacheEnvelope | AdminOverviewResponse;
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return isAdminOverviewResponse(parsed.data) ? parsed.data : null;
    }
    return isAdminOverviewResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeAdminOverviewCache(
  data: AdminOverviewResponse,
  savedAt: number = Date.now()
): string {
  const envelope: AdminOverviewCacheEnvelope = { savedAt, data };
  return JSON.stringify(envelope);
}

export function readAdminOverviewCache(): AdminOverviewResponse | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return parseAdminOverviewCache(localStorage.getItem(ADMIN_OVERVIEW_CACHE_KEY));
  } catch {
    return null;
  }
}

export function persistAdminOverviewCache(data: AdminOverviewResponse): void {
  if (typeof localStorage === 'undefined') return;
  if (!isAdminOverviewResponse(data)) return;
  try {
    localStorage.setItem(ADMIN_OVERVIEW_CACHE_KEY, serializeAdminOverviewCache(data));
  } catch {
    /* quota / private mode */
  }
}
