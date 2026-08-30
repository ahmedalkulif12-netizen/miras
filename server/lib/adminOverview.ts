import admin from 'firebase-admin';
import { normalizeOrderStatus, isActiveTripStatus } from './orderStatus.ts';
import { buildAdminFinancialLedger } from './adminFinancials.ts';
import { listAdminDirectory } from './adminDirectory.ts';
import { listAdminDrivers } from './adminDrivers.ts';
import {
  isGhostAdminOrder,
  isReviewQueueDriverStatus,
  listAdminOrderDocuments,
  mapDriverApplicationToFeedItem,
  mapOrderDocToFeedItem,
  mergeAdminFeed,
  type AdminFeedItem,
} from './adminOrders.ts';

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
}

/** Admin dashboard metrics — read-only via Admin SDK (P0-14 protected route). */
export async function getAdminOverview(db: admin.firestore.Firestore): Promise<AdminOverviewResult> {
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
  };
}
