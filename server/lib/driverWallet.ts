import admin from 'firebase-admin';

/** Must match src/domain/financials.ts — server never trusts client rates. */
export const DRIVER_COMMISSION_RATE = 0.15;

export interface OrderTripMoney {
  tripFare: number;
  platformFee: number;
  driverNet: number;
}

export interface DriverWalletSnapshot {
  driverId: string;
  balance: number;
  totalEarnings: number;
  platformCommission: number;
  netEarnings: number;
  lastPayoutAmount: number;
  lastPayoutAt: admin.firestore.FieldValue | admin.firestore.Timestamp | string | null;
  payoutCount: number;
  completedOrderCount: number;
  currency: 'SAR';
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Read trip money from the order document only (never from the client body).
 */
export function readOrderTripMoney(order: Record<string, unknown>): OrderTripMoney {
  const financials =
    order.financials && typeof order.financials === 'object'
      ? (order.financials as Record<string, unknown>)
      : {};

  let tripFare = Number(financials.tripFare ?? order.tripFare ?? 0);
  let platformFee = Number(financials.platformFee ?? order.commission_amount ?? 0);
  let driverNet = Number(financials.driverNet ?? order.driver_earning ?? 0);

  if (!Number.isFinite(tripFare) || tripFare < 0) tripFare = 0;
  if (!Number.isFinite(platformFee) || platformFee < 0) platformFee = 0;
  if (!Number.isFinite(driverNet) || driverNet < 0) driverNet = 0;

  if (tripFare > 0 && (platformFee === 0 || driverNet === 0)) {
    platformFee = roundMoney(tripFare * DRIVER_COMMISSION_RATE);
    driverNet = roundMoney(tripFare - platformFee);
  }

  return {
    tripFare: roundMoney(tripFare),
    platformFee: roundMoney(platformFee),
    driverNet: roundMoney(driverNet),
  };
}

function emptyWallet(driverId: string): DriverWalletSnapshot {
  return {
    driverId,
    balance: 0,
    totalEarnings: 0,
    platformCommission: 0,
    netEarnings: 0,
    lastPayoutAmount: 0,
    lastPayoutAt: null,
    payoutCount: 0,
    completedOrderCount: 0,
    currency: 'SAR',
  };
}

export function readWalletSnapshot(
  driverId: string,
  data: Record<string, unknown> | undefined
): DriverWalletSnapshot {
  if (!data) return emptyWallet(driverId);
  const lastPayout =
    data.lastPayout && typeof data.lastPayout === 'object'
      ? (data.lastPayout as Record<string, unknown>)
      : null;
  return {
    driverId,
    balance: roundMoney(Number(data.balance) || 0),
    totalEarnings: roundMoney(Number(data.totalEarnings) || 0),
    platformCommission: roundMoney(Number(data.platformCommission) || 0),
    netEarnings: roundMoney(Number(data.netEarnings) || 0),
    lastPayoutAmount: roundMoney(
      Number(data.lastPayoutAmount ?? lastPayout?.amount) || 0
    ),
    lastPayoutAt: (data.lastPayoutAt ?? lastPayout?.at ?? null) as
      | admin.firestore.Timestamp
      | string
      | null,
    payoutCount: Number(data.payoutCount) || 0,
    completedOrderCount: Number(data.completedOrderCount) || 0,
    currency: 'SAR',
  };
}

/**
 * Credit a completed trip onto wallets/{driverId} inside an existing transaction.
 * Amounts come from the order snapshot — not the request body.
 */
export function creditWalletForCompletedTrip(
  tx: admin.firestore.Transaction,
  walletRef: admin.firestore.DocumentReference,
  walletSnap: admin.firestore.DocumentSnapshot,
  input: { driverId: string } & OrderTripMoney
): DriverWalletSnapshot {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const current = readWalletSnapshot(
    input.driverId,
    walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : undefined
  );
  const next: DriverWalletSnapshot = {
    ...current,
    balance: roundMoney(current.balance + input.driverNet),
    totalEarnings: roundMoney(current.totalEarnings + input.tripFare),
    platformCommission: roundMoney(current.platformCommission + input.platformFee),
    netEarnings: roundMoney(current.netEarnings + input.driverNet),
    completedOrderCount: current.completedOrderCount + 1,
  };

  const payload = {
    driverId: input.driverId,
    balance: next.balance,
    totalEarnings: next.totalEarnings,
    platformCommission: next.platformCommission,
    netEarnings: next.netEarnings,
    lastPayoutAmount: current.lastPayoutAmount,
    lastPayoutAt: current.lastPayoutAt,
    lastPayout: current.lastPayoutAmount
      ? { amount: current.lastPayoutAmount, at: current.lastPayoutAt }
      : null,
    payoutCount: current.payoutCount,
    completedOrderCount: next.completedOrderCount,
    currency: 'SAR',
    updatedAt: now,
  };

  if (!walletSnap.exists) {
    tx.set(walletRef, payload);
  } else {
    tx.set(walletRef, payload, { merge: true });
  }

  return next;
}

/** Record a paid settlement on the wallet (balance already held on request create). */
export function recordWalletPayoutPaid(
  tx: admin.firestore.Transaction,
  walletRef: admin.firestore.DocumentReference,
  walletSnap: admin.firestore.DocumentSnapshot,
  input: { driverId: string; amount: number }
): void {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const amount = roundMoney(input.amount);
  const current = readWalletSnapshot(
    input.driverId,
    walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : undefined
  );

  const payload = {
    driverId: input.driverId,
    lastPayoutAmount: amount,
    lastPayoutAt: now,
    lastPayout: { amount, at: now },
    payoutCount: current.payoutCount + 1,
    updatedAt: now,
    currency: 'SAR',
  };

  if (!walletSnap.exists) {
    tx.set(walletRef, {
      ...emptyWallet(input.driverId),
      ...payload,
      balance: 0,
    });
  } else {
    tx.update(walletRef, payload);
  }
}
