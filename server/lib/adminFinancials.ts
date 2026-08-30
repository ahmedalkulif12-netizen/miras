import admin from 'firebase-admin';
import { normalizeOrderStatus } from './orderStatus.ts';
import {
  isGhostAdminOrder,
  listAdminOrderDocuments,
  orderSortMs,
} from './adminOrders.ts';
import { timestampToIso } from './timestamps.ts';

export interface AdminFinancialLedger {
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

function readMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Precise financial ledger from completed (and captured) orders.
 * Platform revenue = platformFee (driver commission) + serviceFee (customer fee).
 */
export function buildAdminFinancialLedger(
  orderDocs: admin.firestore.QueryDocumentSnapshot[]
): AdminFinancialLedger {
  let completedOrders = 0;
  let clientPaymentsTotal = 0;
  let driverEarningsTotal = 0;
  let platformCommissionTotal = 0;
  let serviceFeesTotal = 0;
  let tripFareTotal = 0;

  const recentEntries: AdminFinancialLedger['recentEntries'] = [];

  const live = orderDocs
    .filter((doc) => !isGhostAdminOrder(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => {
      const dataA = a.data() as Record<string, unknown>;
      const dataB = b.data() as Record<string, unknown>;
      return orderSortMs(dataB) - orderSortMs(dataA);
    });

  for (const doc of live) {
    const data = doc.data() as Record<string, unknown>;
    const status = normalizeOrderStatus(String(data.status || ''));
    const financials = (data.financials || {}) as Record<string, unknown>;

    const tripFare = readMoney(financials.tripFare ?? data.tripFare);
    const serviceFee = readMoney(financials.serviceFee ?? data.serviceFee);
    const customerTotal = readMoney(
      financials.customerTotal ?? data.totalPrice ?? data.price ?? tripFare + serviceFee
    );
    const platformFee = readMoney(financials.platformFee ?? data.commission_amount);
    const driverNet = readMoney(financials.driverNet ?? data.driver_earning);

    if (status === 'completed') {
      completedOrders += 1;
      clientPaymentsTotal += customerTotal;
      driverEarningsTotal += driverNet;
      platformCommissionTotal += platformFee;
      serviceFeesTotal += serviceFee;
      tripFareTotal += tripFare;
    }

    if (recentEntries.length < 40) {
      recentEntries.push({
        orderId: doc.id,
        userId: String(data.userId || ''),
        driverId: String(data.driverId || ''),
        serviceType: String(data.serviceType || 'unknown'),
        status: String(data.status || ''),
        clientPayment: customerTotal,
        driverNet,
        platformFee,
        serviceFee,
        tripFare,
        createdAt: timestampToIso(data.createdAt || data.promotedAt || data.updatedAt),
      });
    }
  }

  return {
    summary: {
      currency: 'SAR',
      completedOrders,
      clientPaymentsTotal: Math.round(clientPaymentsTotal * 100) / 100,
      driverEarningsTotal: Math.round(driverEarningsTotal * 100) / 100,
      platformCommissionTotal: Math.round(platformCommissionTotal * 100) / 100,
      serviceFeesTotal: Math.round(serviceFeesTotal * 100) / 100,
      tripFareTotal: Math.round(tripFareTotal * 100) / 100,
    },
    recentEntries,
  };
}

export async function getAdminFinancialLedger(
  db: admin.firestore.Firestore
): Promise<AdminFinancialLedger> {
  const orderDocs = await listAdminOrderDocuments(db, 400);
  return buildAdminFinancialLedger(orderDocs);
}
