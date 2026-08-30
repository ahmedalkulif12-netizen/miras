/**
 * Local customer wallet cache. Production balance comes from Firestore
 * (server-owned). Never seed a fake starting balance.
 */

export interface CustomerWalletTransaction {
  id: string;
  type: 'payment' | 'topup';
  orderId?: string;
  amount: number;
  createdAt: string;
  isDebit: boolean;
}

export interface CustomerWalletView {
  balance: number;
  deductedOrderIds: string[];
  lastDebitAmount: number;
  lastDebitAt: string | null;
  transactions: CustomerWalletTransaction[];
}

const KEY_PREFIX = 'miras_customer_wallet_';
export const LOCAL_CUSTOMER_WALLET_EVENT = 'miras-customer-wallet-changed';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyWallet(): CustomerWalletView {
  return {
    balance: 0,
    deductedOrderIds: [],
    lastDebitAmount: 0,
    lastDebitAt: null,
    transactions: [],
  };
}

export function parseWalletTransactions(raw: unknown): CustomerWalletTransaction[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomerWalletTransaction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const amount = roundMoney(Number(row.amount) || 0);
    if (!(amount > 0)) continue;
    const type = row.type === 'topup' ? 'topup' : 'payment';
    const createdAt =
      typeof row.createdAt === 'string'
        ? row.createdAt
        : new Date().toISOString();
    out.push({
      id: String(row.id || `${type}_${createdAt}`),
      type,
      orderId: row.orderId ? String(row.orderId) : undefined,
      amount,
      createdAt,
      isDebit: type === 'payment' ? true : Boolean(row.isDebit),
    });
  }
  return out;
}

export function mergeWalletTransactions(
  ...lists: Array<CustomerWalletTransaction[] | undefined>
): CustomerWalletTransaction[] {
  const byId = new Map<string, CustomerWalletTransaction>();
  for (const list of lists) {
    for (const tx of list || []) {
      if (!tx?.id) continue;
      if (!byId.has(tx.id)) byId.set(tx.id, tx);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export function loadLocalCustomerWallet(uid: string): CustomerWalletView {
  if (!uid) return emptyWallet();
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${uid}`);
    if (!raw) return emptyWallet();
    const parsed = JSON.parse(raw) as Partial<CustomerWalletView>;
    return {
      balance: roundMoney(Number(parsed.balance) || 0),
      deductedOrderIds: Array.isArray(parsed.deductedOrderIds)
        ? parsed.deductedOrderIds.map(String).slice(-200)
        : [],
      lastDebitAmount: roundMoney(Number(parsed.lastDebitAmount) || 0),
      lastDebitAt: parsed.lastDebitAt || null,
      transactions: parseWalletTransactions(parsed.transactions),
    };
  } catch {
    return emptyWallet();
  }
}

function saveLocalCustomerWallet(uid: string, wallet: CustomerWalletView): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${uid}`, JSON.stringify(wallet));
    window.dispatchEvent(
      new CustomEvent(LOCAL_CUSTOMER_WALLET_EVENT, { detail: { uid } })
    );
  } catch {
    /* ignore */
  }
}

function prependTransaction(
  list: CustomerWalletTransaction[],
  tx: CustomerWalletTransaction
): CustomerWalletTransaction[] {
  if (list.some((item) => item.id === tx.id)) return list;
  return [tx, ...list].slice(0, 200);
}

export function debitLocalCustomerWallet(
  uid: string,
  amount: number,
  orderId?: string
): CustomerWalletView {
  const current = loadLocalCustomerWallet(uid);
  if (orderId && current.deductedOrderIds.includes(orderId)) {
    return current;
  }
  const debit = roundMoney(Math.max(0, amount));
  const now = new Date().toISOString();
  const paymentTx: CustomerWalletTransaction | null =
    debit > 0
      ? {
          id: orderId ? `pay_${orderId}` : `pay_${now}`,
          type: 'payment',
          orderId,
          amount: debit,
          createdAt: now,
          isDebit: true,
        }
      : null;
  const next: CustomerWalletView = {
    balance: roundMoney(Math.max(0, current.balance - debit)),
    deductedOrderIds: orderId
      ? [...current.deductedOrderIds, orderId].slice(-200)
      : current.deductedOrderIds,
    lastDebitAmount: debit,
    lastDebitAt: now,
    transactions: paymentTx
      ? prependTransaction(current.transactions, paymentTx)
      : current.transactions,
  };
  saveLocalCustomerWallet(uid, next);
  return next;
}

export function creditLocalCustomerWallet(uid: string, amount: number): CustomerWalletView {
  const current = loadLocalCustomerWallet(uid);
  const credit = roundMoney(Math.max(0, amount));
  const now = new Date().toISOString();
  const topupTx: CustomerWalletTransaction | null =
    credit > 0
      ? {
          id: `topup_${now}`,
          type: 'topup',
          amount: credit,
          createdAt: now,
          isDebit: false,
        }
      : null;
  const next = {
    ...current,
    balance: roundMoney(current.balance + credit),
    transactions: topupTx
      ? prependTransaction(current.transactions, topupTx)
      : current.transactions,
  };
  saveLocalCustomerWallet(uid, next);
  return next;
}

export function subscribeLocalCustomerWallet(
  uid: string,
  onChange: (wallet: CustomerWalletView) => void
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string }>).detail;
    if (!detail?.uid || detail.uid === uid) {
      onChange(loadLocalCustomerWallet(uid));
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === `${KEY_PREFIX}${uid}`) {
      onChange(loadLocalCustomerWallet(uid));
    }
  };
  window.addEventListener(LOCAL_CUSTOMER_WALLET_EVENT, handler);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(LOCAL_CUSTOMER_WALLET_EVENT, handler);
    window.removeEventListener('storage', onStorage);
  };
}
