import admin from 'firebase-admin';
import { normalizeOrderStatus, isActiveTripStatus } from './orderStatus.ts';
import { buildAdminFinancialLedger } from './adminFinancials.ts';
import { listAdminDirectory } from './adminDirectory.ts';
import { isReviewQueueDriverStatus, listAdminDrivers } from './adminDrivers.ts';
import {
  isGhostAdminOrder,
  listAdminOrderDocuments,
  mapDriverApplicationToFeedItem,
  mapOrderDocToFeedItem,
  mergeAdminFeed,
  type AdminFeedItem,
} from './adminOrders.ts';
import { aggregateServiceDistribution } from '../../src/domain/serviceCategories.ts';

export interface AdminOverviewResult {
  stats: {
    activeDrivers: number;
    pendingDrivers: number;
    totalUsers: number;
    totalDrivers: number;
    totalIndividualDrivers: number;
    totalFleetDrivers: number;
    totalClients: number;
    totalCorporate: number;
    totalOperators: number;
    activeTrips: number;
    completedOrders: number;
    openOrders: number;
    netRevenueSar: number;
    clientPaymentsSar: number;
    driverEarningsSar: number;
    platformCommissionSar: number;
  };
  recentOrders: AdminFeedItem[];
  serviceDistribution: Array<{
    serviceType: string;
    count: number;
    percentage: number;
  }>;
}

export function emptyAdminOverview(): AdminOverviewResult {
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

/** Admin dashboard metrics — read-only via Admin SDK (P0-14 protected route). */
export async function getAdminOverview(db: admin.firestore.Firestore): Promise<AdminOverviewResult> {
  try {
    const [orderDocs, driverRows, directory] = await Promise.all([
      listAdminOrderDocuments(db),
      listAdminDrivers(db),
      listAdminDirectory(db),
    ]);
    const ledger = buildAdminFinancialLedger(orderDocs);

    let activeTrips = 0;
    let completedOrders = 0;
    let openOrders = 0;

    const liveOrders = orderDocs.filter((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return !isGhostAdminOrder(doc.id, data);
    });

    const orderFeed: AdminFeedItem[] = [];
    liveOrders.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const status = String(data.status || '');
      const normalized = normalizeOrderStatus(status);
      if (isActiveTripStatus(status)) activeTrips += 1;
      if (normalized === 'completed') completedOrders += 1;
      if (
        normalized === 'broadcasting' ||
        normalized === 'payment_authorized' ||
        status === 'pending' ||
        status === 'searching_driver'
      ) {
        openOrders += 1;
      }
      orderFeed.push(mapOrderDocToFeedItem(doc.id, data));
    });

    const pendingDriverRows = driverRows.filter((row) => isReviewQueueDriverStatus(row.status));
    const activeDrivers = driverRows.filter((row) => row.status === 'approved').length;
    const pendingDrivers = pendingDriverRows.length;

    const recentOrders = mergeAdminFeed(
      orderFeed,
      pendingDriverRows.map(mapDriverApplicationToFeedItem),
      40
    );
    const serviceDistribution = aggregateServiceDistribution(
      liveOrders.map((doc) => doc.data() as Record<string, unknown>)
    );

    return {
      stats: {
        activeDrivers,
        pendingDrivers,
        totalUsers: directory.stats.totalUsers,
        totalDrivers: directory.stats.totalDrivers,
        totalIndividualDrivers: directory.stats.totalIndividualDrivers,
        totalFleetDrivers: directory.stats.totalFleetDrivers,
        totalClients: directory.stats.totalClients,
        totalCorporate: directory.stats.totalCorporate,
        totalOperators: directory.stats.totalOperators,
        activeTrips,
        completedOrders,
        openOrders,
        netRevenueSar: Math.round(
          ledger.summary.platformCommissionTotal + ledger.summary.serviceFeesTotal
        ),
        clientPaymentsSar: Math.round(ledger.summary.clientPaymentsTotal),
        driverEarningsSar: Math.round(ledger.summary.driverEarningsTotal),
        platformCommissionSar: Math.round(ledger.summary.platformCommissionTotal),
      },
      recentOrders,
      serviceDistribution,
    };
  } catch (error) {
    console.error('[adminOverview] Firestore/Admin unavailable — returning empty summary:', error);
    return emptyAdminOverview();
  }
}
