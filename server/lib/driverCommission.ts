import admin from 'firebase-admin';
import {
  financialsWithDriverCommission,
  readCompletedOrdersCount,
  readDriverProfileCommissionPercentage,
  resolveDriverCommissionPercentage,
  toPersistedOrderMoneyFields,
  type TripFinancials,
} from '../../src/domain/financials.ts';
import {
  mergePricingConfig,
  normalizeServiceType,
  pricingDocCandidates,
} from '../../src/lib/pricingDefaults.ts';

export interface DriverCommissionResolution {
  commissionPercentage: number;
  completedOrdersCount: number;
  financials: TripFinancials;
  moneyFields: ReturnType<typeof toPersistedOrderMoneyFields>;
}

/**
 * Read pricing/{service}, drivers/{uid}, and wallets/{uid} inside the caller's
 * transaction, then price the driver's commission from loyalty or a profile override.
 * Customer total on the order is left unchanged.
 */
export async function resolveOrderDriverCommission(
  db: admin.firestore.Firestore,
  tx: admin.firestore.Transaction,
  order: Record<string, unknown>,
  driverId: string,
  walletData?: Record<string, unknown> | null
): Promise<DriverCommissionResolution> {
  const serviceType = normalizeServiceType(
    String(order.serviceType || order.requiredVehicleType || 'flatbed')
  );
  const driverRef = db.collection('drivers').doc(driverId);
  const pricingRefs = pricingDocCandidates(serviceType).map((id) =>
    db.collection('pricing').doc(id)
  );
  const walletRef = db.collection('wallets').doc(driverId);

  const driverSnap = await tx.get(driverRef);
  const pricingSnaps = await Promise.all(pricingRefs.map((ref) => tx.get(ref)));
  const walletSnap = walletData === undefined ? await tx.get(walletRef) : null;

  const driver = driverSnap.exists
    ? (driverSnap.data() as Record<string, unknown>)
    : null;
  let pricingRow: Record<string, unknown> | null = null;
  for (const snap of pricingSnaps) {
    if (snap.exists) {
      pricingRow = snap.data() as Record<string, unknown>;
      break;
    }
  }
  const pricing = mergePricingConfig(serviceType, pricingRow);
  const wallet =
    walletData !== undefined
      ? walletData
      : walletSnap?.exists
        ? (walletSnap.data() as Record<string, unknown>)
        : null;

  const completedOrdersCount = readCompletedOrdersCount(driver, wallet);
  const commissionPercentage = resolveDriverCommissionPercentage({
    completedOrdersCount,
    tiers: pricing.driver_commission_tiers,
    basePercentage: pricing.platform_commission_percentage,
    profilePercentage: readDriverProfileCommissionPercentage(driver),
  });
  const financials = financialsWithDriverCommission(
    order,
    commissionPercentage,
    completedOrdersCount
  );
  return {
    commissionPercentage,
    completedOrdersCount,
    financials,
    moneyFields: toPersistedOrderMoneyFields(financials),
  };
}

/** Fields written on drivers/{uid} after a trip is credited, so the next band can move. */
export function driverCompletedCountFields(nextCount: number): {
  completed_orders_count: number;
  completedOrderCount: number;
} {
  const count = Math.max(0, Math.floor(Number(nextCount) || 0));
  return {
    completed_orders_count: count,
    completedOrderCount: count,
  };
}
