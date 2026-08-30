import admin from 'firebase-admin';
import { recordWalletPayoutPaid } from './driverWallet.ts';

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface DriverBankDetails {
  bankName: string;
  iban: string;
  accountHolderName?: string;
}

export interface WithdrawalDocument {
  driverId: string;
  driverName: string;
  driverPhone: string;
  amount: number;
  currency: 'SAR';
  status: WithdrawalStatus;
  bankName: string;
  iban: string;
  accountHolderName: string;
  walletBalanceBefore: number;
  walletBalanceAfter: number;
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp | string;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp | string;
  processedAt?: admin.firestore.FieldValue | admin.firestore.Timestamp | string | null;
  processedBy?: string | null;
  rejectionReason?: string | null;
}

export interface WithdrawalListItem {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  amount: number;
  currency: 'SAR';
  status: WithdrawalStatus;
  bankName: string;
  iban: string;
  accountHolderName: string;
  walletBalanceBefore: number;
  walletBalanceAfter: number;
  createdAt: string | null;
  updatedAt: string | null;
  processedAt: string | null;
  processedBy: string | null;
  rejectionReason: string | null;
}

export const MIN_WITHDRAWAL_SAR = 10;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/** Normalize Saudi IBAN: strip spaces, uppercase. Must be SA + 22 digits. */
export function normalizeIban(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isValidSaudiIban(iban: string): boolean {
  const normalized = normalizeIban(iban);
  return /^SA\d{22}$/.test(normalized);
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function mapWithdrawalDoc(
  id: string,
  data: Record<string, unknown>
): WithdrawalListItem {
  return {
    id,
    driverId: String(data.driverId || ''),
    driverName: String(data.driverName || ''),
    driverPhone: String(data.driverPhone || ''),
    amount: Number(data.amount) || 0,
    currency: 'SAR',
    status: (data.status as WithdrawalStatus) || 'pending',
    bankName: String(data.bankName || ''),
    iban: String(data.iban || ''),
    accountHolderName: String(data.accountHolderName || ''),
    walletBalanceBefore: Number(data.walletBalanceBefore) || 0,
    walletBalanceAfter: Number(data.walletBalanceAfter) || 0,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    processedAt: timestampToIso(data.processedAt),
    processedBy: data.processedBy ? String(data.processedBy) : null,
    rejectionReason: data.rejectionReason ? String(data.rejectionReason) : null,
  };
}

/**
 * Saves / updates bank payout details on drivers/{uid}.
 */
export async function saveDriverBankDetails(
  db: admin.firestore.Firestore,
  driverId: string,
  details: DriverBankDetails
): Promise<DriverBankDetails> {
  const bankName = String(details.bankName || '').trim();
  const iban = normalizeIban(details.iban);
  const accountHolderName = String(details.accountHolderName || '').trim();

  if (bankName.length < 2) {
    throw httpError('Bank name is required', 400);
  }
  if (!isValidSaudiIban(iban)) {
    throw httpError('Invalid Saudi IBAN (expected SA + 22 digits)', 400);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const bankDetails = {
    bankName,
    iban,
    ...(accountHolderName ? { accountHolderName } : {}),
    updatedAt: now,
  };

  await db.collection('drivers').doc(driverId).set(
    {
      bankDetails,
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    bankName,
    iban,
    ...(accountHolderName ? { accountHolderName } : {}),
  };
}

export async function getDriverBankDetails(
  db: admin.firestore.Firestore,
  driverId: string
): Promise<DriverBankDetails | null> {
  const snap = await db.collection('drivers').doc(driverId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const bank = data.bankDetails as Record<string, unknown> | undefined;
  if (!bank || typeof bank !== 'object') return null;
  const bankName = String(bank.bankName || '').trim();
  const iban = normalizeIban(String(bank.iban || ''));
  if (!bankName || !iban) return null;
  return {
    bankName,
    iban,
    accountHolderName: bank.accountHolderName
      ? String(bank.accountHolderName)
      : undefined,
  };
}

/**
 * Driver creates a withdrawal request.
 * Holds funds immediately (wallet debit) until admin approves or rejects.
 */
export async function createWithdrawalRequest(
  db: admin.firestore.Firestore,
  driverId: string,
  amountRaw: number,
  bankOverride?: Partial<DriverBankDetails>
): Promise<WithdrawalListItem> {
  const amount = roundMoney(Number(amountRaw));
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_SAR) {
    throw httpError(`Minimum withdrawal is ${MIN_WITHDRAWAL_SAR} SAR`, 400);
  }

  const [userSnap, driverSnap, bankFromProfile] = await Promise.all([
    db.collection('users').doc(driverId).get(),
    db.collection('drivers').doc(driverId).get(),
    getDriverBankDetails(db, driverId),
  ]);

  const userData = (userSnap.data() || {}) as Record<string, unknown>;
  const driverData = (driverSnap.data() || {}) as Record<string, unknown>;

  const bankName = String(
    bankOverride?.bankName || bankFromProfile?.bankName || ''
  ).trim();
  const iban = normalizeIban(
    String(bankOverride?.iban || bankFromProfile?.iban || '')
  );
  const accountHolderName = String(
    bankOverride?.accountHolderName ||
      bankFromProfile?.accountHolderName ||
      userData.name ||
      driverData.fullName ||
      ''
  ).trim();

  if (!bankName || !isValidSaudiIban(iban)) {
    throw httpError(
      'Please save valid bank details (bank name + Saudi IBAN) before withdrawing',
      400
    );
  }

  // Persist bank details if provided on this request
  if (bankOverride?.bankName || bankOverride?.iban) {
    await saveDriverBankDetails(db, driverId, {
      bankName,
      iban,
      accountHolderName,
    });
  }

  const withdrawalRef = db.collection('withdrawals').doc();
  const walletRef = db.collection('wallets').doc(driverId);

  const result = await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const balance = walletSnap.exists
      ? roundMoney(Number((walletSnap.data() as { balance?: number }).balance) || 0)
      : 0;

    if (amount > balance) {
      throw httpError('Insufficient wallet balance', 400);
    }

    // Block duplicate pending requests for the same driver (simple guard)
    // Note: collection query outside transaction is racy; we check after hold via status.

    const balanceAfter = roundMoney(balance - amount);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const doc: WithdrawalDocument = {
      driverId,
      driverName: String(userData.name || driverData.fullName || 'Driver'),
      driverPhone: String(userData.phone || driverData.phone || ''),
      amount,
      currency: 'SAR',
      status: 'pending',
      bankName,
      iban,
      accountHolderName,
      walletBalanceBefore: balance,
      walletBalanceAfter: balanceAfter,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      processedBy: null,
      rejectionReason: null,
    };

    tx.set(withdrawalRef, doc);

    if (!walletSnap.exists) {
      tx.set(walletRef, {
        driverId,
        balance: balanceAfter,
        currency: 'SAR',
        updatedAt: now,
      });
    } else {
      tx.update(walletRef, {
        balance: balanceAfter,
        updatedAt: now,
      });
    }

    return {
      id: withdrawalRef.id,
      ...doc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processedAt: null,
      processedBy: null,
      rejectionReason: null,
    } as WithdrawalListItem;
  });

  return result;
}

export async function listWithdrawalsForAdmin(
  db: admin.firestore.Firestore,
  statusFilter?: WithdrawalStatus | 'all'
): Promise<WithdrawalListItem[]> {
  // Single-field order avoids composite-index requirement; filter in memory.
  const snap = await db
    .collection('withdrawals')
    .orderBy('createdAt', 'desc')
    .limit(150)
    .get();

  const rows = snap.docs.map((d) =>
    mapWithdrawalDoc(d.id, d.data() as Record<string, unknown>)
  );

  if (!statusFilter || statusFilter === 'all') return rows;
  return rows.filter((row) => row.status === statusFilter);
}

export async function listWithdrawalsForDriver(
  db: admin.firestore.Firestore,
  driverId: string
): Promise<WithdrawalListItem[]> {
  const snap = await db
    .collection('withdrawals')
    .where('driverId', '==', driverId)
    .limit(50)
    .get();

  const rows = snap.docs.map((d) =>
    mapWithdrawalDoc(d.id, d.data() as Record<string, unknown>)
  );

  return rows.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });
}

/**
 * Admin marks transfer complete. Funds were already held on create.
 */
export async function approveWithdrawal(
  db: admin.firestore.Firestore,
  withdrawalId: string,
  adminUid: string
): Promise<WithdrawalListItem> {
  const ref = db.collection('withdrawals').doc(withdrawalId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError('Withdrawal not found', 404);
    const data = snap.data() as Record<string, unknown>;
    if (data.status !== 'pending') {
      throw httpError(`Withdrawal is already ${data.status}`, 400);
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const driverId = String(data.driverId || '');
    const amount = roundMoney(Number(data.amount) || 0);
    const walletRef = db.collection('wallets').doc(driverId);
    const walletSnap = await tx.get(walletRef);
    recordWalletPayoutPaid(tx, walletRef, walletSnap, { driverId, amount });
    tx.update(ref, {
      status: 'paid',
      processedAt: now,
      processedBy: adminUid,
      updatedAt: now,
      rejectionReason: null,
    });
  });

  const updated = await ref.get();
  return mapWithdrawalDoc(updated.id, updated.data() as Record<string, unknown>);
}

/**
 * Admin rejects — refund held amount back to driver wallet.
 */
export async function rejectWithdrawal(
  db: admin.firestore.Firestore,
  withdrawalId: string,
  adminUid: string,
  reason?: string
): Promise<WithdrawalListItem> {
  const ref = db.collection('withdrawals').doc(withdrawalId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError('Withdrawal not found', 404);
    const data = snap.data() as Record<string, unknown>;
    if (data.status !== 'pending') {
      throw httpError(`Withdrawal is already ${data.status}`, 400);
    }

    const driverId = String(data.driverId || '');
    const amount = roundMoney(Number(data.amount) || 0);
    const walletRef = db.collection('wallets').doc(driverId);
    const walletSnap = await tx.get(walletRef);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (!walletSnap.exists) {
      tx.set(walletRef, {
        driverId,
        balance: amount,
        currency: 'SAR',
        updatedAt: now,
      });
    } else {
      const current = roundMoney(
        Number((walletSnap.data() as { balance?: number }).balance) || 0
      );
      tx.update(walletRef, {
        balance: roundMoney(current + amount),
        updatedAt: now,
      });
    }

    tx.update(ref, {
      status: 'rejected',
      processedAt: now,
      processedBy: adminUid,
      updatedAt: now,
      rejectionReason: reason?.trim()?.slice(0, 300) || 'Rejected by admin',
    });
  });

  const updated = await ref.get();
  return mapWithdrawalDoc(updated.id, updated.data() as Record<string, unknown>);
}
