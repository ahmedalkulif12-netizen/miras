/**
 * Localhost-only wallet mirror when Admin Firestore is unavailable.
 * Production credits always go through POST /api/orders/:id/complete.
 */

export interface DriverWalletView {
  balance: number;
  totalEarnings: number;
  platformCommission: number;
  netEarnings: number;
  lastPayoutAmount: number;
  lastPayoutAt: string | null;
  payoutCount: number;
  completedOrderCount: number;
  creditedOrderIds: string[];
  /** Localhost pending withdrawal holds (Admin cannot debit wallets). */
  heldBalance: number;
}

const KEY_PREFIX = 'miras_driver_wallet_';
export const LOCAL_WALLET_EVENT = 'miras-driver-wallet-changed';

function emptyWallet(): DriverWalletView {
  return {
    balance: 0,
    totalEarnings: 0,
    platformCommission: 0,
    netEarnings: 0,
    lastPayoutAmount: 0,
    lastPayoutAt: null,
    payoutCount: 0,
    completedOrderCount: 0,
    creditedOrderIds: [],
    heldBalance: 0,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function loadLocalDriverWallet(driverId: string): DriverWalletView {
  if (!driverId) return emptyWallet();
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${driverId}`);
    if (!raw) return emptyWallet();
    const parsed = JSON.parse(raw) as Partial<DriverWalletView>;
    return {
      ...emptyWallet(),
      ...parsed,
      balance: roundMoney(Number(parsed.balance) || 0),
      totalEarnings: roundMoney(Number(parsed.totalEarnings) || 0),
      platformCommission: roundMoney(Number(parsed.platformCommission) || 0),
      netEarnings: roundMoney(Number(parsed.netEarnings) || 0),
      lastPayoutAmount: roundMoney(Number(parsed.lastPayoutAmount) || 0),
      lastPayoutAt: parsed.lastPayoutAt || null,
      payoutCount: Number(parsed.payoutCount) || 0,
      completedOrderCount: Number(parsed.completedOrderCount) || 0,
      creditedOrderIds: Array.isArray(parsed.creditedOrderIds)
        ? parsed.creditedOrderIds.map(String).slice(-200)
        : [],
      heldBalance: roundMoney(Number(parsed.heldBalance) || 0),
    };
  } catch {
    return emptyWallet();
  }
}

function saveLocalDriverWallet(driverId: string, wallet: DriverWalletView): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${driverId}`, JSON.stringify(wallet));
    window.dispatchEvent(new CustomEvent(LOCAL_WALLET_EVENT, { detail: { driverId } }));
  } catch {
    /* ignore */
  }
}

export function applyLocalWalletCredit(
  driverId: string,
  money: { tripFare: number; platformFee: number; driverNet: number },
  orderId?: string
): DriverWalletView {
  const current = loadLocalDriverWallet(driverId);
  if (orderId && current.creditedOrderIds.includes(orderId)) {
    return current;
  }
  const next: DriverWalletView = {
    ...current,
    balance: roundMoney(current.balance + money.driverNet),
    totalEarnings: roundMoney(current.totalEarnings + money.tripFare),
    platformCommission: roundMoney(current.platformCommission + money.platformFee),
    netEarnings: roundMoney(current.netEarnings + money.driverNet),
    completedOrderCount: current.completedOrderCount + 1,
    creditedOrderIds: orderId
      ? [...current.creditedOrderIds, orderId].slice(-200)
      : current.creditedOrderIds,
  };
  saveLocalDriverWallet(driverId, next);
  return next;
}

export function applyLocalWalletHold(driverId: string, amount: number): DriverWalletView {
  const current = loadLocalDriverWallet(driverId);
  const debit = roundMoney(Math.max(0, amount));
  if (debit > current.balance) {
    throw new Error('Insufficient wallet balance');
  }
  const next = {
    ...current,
    balance: roundMoney(Math.max(0, current.balance - debit)),
    heldBalance: roundMoney((current.heldBalance || 0) + debit),
  };
  saveLocalDriverWallet(driverId, next);
  return next;
}

export function releaseLocalWalletHold(driverId: string, amount: number): DriverWalletView {
  const current = loadLocalDriverWallet(driverId);
  const credit = roundMoney(Math.max(0, amount));
  const held = roundMoney(Math.min(current.heldBalance || 0, credit));
  const next = {
    ...current,
    balance: roundMoney(current.balance + held),
    heldBalance: roundMoney(Math.max(0, (current.heldBalance || 0) - held)),
  };
  saveLocalDriverWallet(driverId, next);
  return next;
}

export function subscribeLocalDriverWallet(
  driverId: string,
  onChange: (wallet: DriverWalletView) => void
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ driverId?: string }>).detail;
    if (!detail?.driverId || detail.driverId === driverId) {
      onChange(loadLocalDriverWallet(driverId));
    }
  };
  window.addEventListener(LOCAL_WALLET_EVENT, handler);
  return () => window.removeEventListener(LOCAL_WALLET_EVENT, handler);
}

export function mergeWalletViews(
  remote: DriverWalletView,
  local: DriverWalletView
): DriverWalletView {
  const remoteAt = remote.lastPayoutAt ? Date.parse(remote.lastPayoutAt) : 0;
  const localAt = local.lastPayoutAt ? Date.parse(local.lastPayoutAt) : 0;
  const useLocalPayout = localAt > remoteAt;
  const held = Math.max(remote.heldBalance || 0, local.heldBalance || 0);
  const grossRemote = roundMoney((remote.balance || 0) + (remote.heldBalance || 0));
  const grossLocal = roundMoney((local.balance || 0) + (local.heldBalance || 0));
  return {
    balance: roundMoney(Math.max(0, Math.max(grossRemote, grossLocal) - held)),
    totalEarnings: Math.max(remote.totalEarnings, local.totalEarnings),
    platformCommission: Math.max(remote.platformCommission, local.platformCommission),
    netEarnings: Math.max(remote.netEarnings, local.netEarnings),
    lastPayoutAmount: useLocalPayout ? local.lastPayoutAmount : remote.lastPayoutAmount,
    lastPayoutAt: useLocalPayout ? local.lastPayoutAt : remote.lastPayoutAt,
    payoutCount: Math.max(remote.payoutCount, local.payoutCount),
    completedOrderCount: Math.max(remote.completedOrderCount, local.completedOrderCount),
    creditedOrderIds: Array.from(
      new Set([...(remote.creditedOrderIds || []), ...(local.creditedOrderIds || [])])
    ).slice(-200),
    heldBalance: held,
  };
}

export function walletFromFirestoreData(
  data: Record<string, unknown> | undefined
): DriverWalletView {
  if (!data) return emptyWallet();
  const lastPayout =
    data.lastPayout && typeof data.lastPayout === 'object'
      ? (data.lastPayout as Record<string, unknown>)
      : null;
  const lastAt = data.lastPayoutAt ?? lastPayout?.at;
  let lastPayoutAt: string | null = null;
  if (typeof lastAt === 'string') lastPayoutAt = lastAt;
  else if (lastAt && typeof lastAt === 'object' && 'toDate' in lastAt) {
    try {
      lastPayoutAt = (lastAt as { toDate: () => Date }).toDate().toISOString();
    } catch {
      lastPayoutAt = null;
    }
  }
  return {
    balance: roundMoney(Number(data.balance) || 0),
    totalEarnings: roundMoney(Number(data.totalEarnings) || 0),
    platformCommission: roundMoney(Number(data.platformCommission) || 0),
    netEarnings: roundMoney(Number(data.netEarnings) || 0),
    lastPayoutAmount: roundMoney(Number(data.lastPayoutAmount ?? lastPayout?.amount) || 0),
    lastPayoutAt,
    payoutCount: Number(data.payoutCount) || 0,
    completedOrderCount: Number(data.completedOrderCount) || 0,
    creditedOrderIds: Array.isArray(data.creditedOrderIds)
      ? data.creditedOrderIds.map(String).slice(-200)
      : [],
    heldBalance: 0,
  };
}
