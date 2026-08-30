import { authFetch, isDevBypassAuthSession } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { readStorageWithLegacy } from '@/lib/storageMigration';
import { isLocalDevRuntime } from '@/lib/localDevRuntime';
import { auth, db, ensureFirebaseReady } from '@/lib/firebase';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  applyLocalWalletHold,
  loadLocalDriverWallet,
  releaseLocalWalletHold,
} from '@/lib/localDriverWallet';

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface DriverBankDetails {
  bankName: string;
  iban: string;
  accountHolderName?: string;
}

export interface WithdrawalRequest {
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

const DEV_WITHDRAWALS_KEY = 'miras_dev_withdrawals';
const LEGACY_DEV_WITHDRAWALS_KEY = 'hamula_dev_withdrawals';
const DEV_BANK_KEY = 'miras_dev_bank_details';
const LEGACY_DEV_BANK_KEY = 'hamula_dev_bank_details';
const LOCAL_BANK_PREFIX = 'miras_driver_bank_';
const LOCAL_WITHDRAWALS_KEY = 'miras_local_withdrawals';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function skipServerPayoutMutation(): boolean {
  if (isDevBypassAuthSession()) return true;
  // Vite `npm run dev` and localhost — never call Admin payout APIs.
  if (import.meta.env.DEV) return true;
  return isLocalDevRuntime();
}

function isClientPayoutFallback(status: number, errorText: string): boolean {
  if (status === 503 || status === 501 || status >= 500) return true;
  return /CLIENT_WRITE_REQUIRED|default credentials|Admin Firestore|Could not load the default credentials|UNAUTHENTICATED|failed to save bank|failed to create withdrawal/i.test(
    errorText
  );
}

function currentDriverUid(): string {
  return auth.currentUser?.uid || '';
}

function loadDevWithdrawals(): WithdrawalRequest[] {
  try {
    const raw = readStorageWithLegacy(
      sessionStorage,
      DEV_WITHDRAWALS_KEY,
      LEGACY_DEV_WITHDRAWALS_KEY
    );
    return raw ? (JSON.parse(raw) as WithdrawalRequest[]) : [];
  } catch {
    return [];
  }
}

function saveDevWithdrawals(rows: WithdrawalRequest[]) {
  try {
    sessionStorage.setItem(DEV_WITHDRAWALS_KEY, JSON.stringify(rows));
    sessionStorage.removeItem(LEGACY_DEV_WITHDRAWALS_KEY);
  } catch {
    /* ignore */
  }
}

function loadLocalWithdrawals(): WithdrawalRequest[] {
  try {
    const raw = localStorage.getItem(LOCAL_WITHDRAWALS_KEY);
    const stored = raw ? (JSON.parse(raw) as WithdrawalRequest[]) : [];
    return [...stored, ...loadDevWithdrawals()].filter(
      (row, index, list) => list.findIndex((item) => item.id === row.id) === index
    );
  } catch {
    return loadDevWithdrawals();
  }
}

function saveLocalWithdrawals(rows: WithdrawalRequest[]) {
  try {
    localStorage.setItem(LOCAL_WITHDRAWALS_KEY, JSON.stringify(rows.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

function loadDevBank(): DriverBankDetails | null {
  try {
    const raw = readStorageWithLegacy(sessionStorage, DEV_BANK_KEY, LEGACY_DEV_BANK_KEY);
    return raw ? (JSON.parse(raw) as DriverBankDetails) : null;
  } catch {
    return null;
  }
}

function saveDevBank(details: DriverBankDetails) {
  try {
    sessionStorage.setItem(DEV_BANK_KEY, JSON.stringify(details));
    sessionStorage.removeItem(LEGACY_DEV_BANK_KEY);
  } catch {
    /* ignore */
  }
}

function loadLocalBank(uid: string): DriverBankDetails | null {
  if (!uid) return loadDevBank();
  try {
    const raw = localStorage.getItem(`${LOCAL_BANK_PREFIX}${uid}`);
    if (raw) return JSON.parse(raw) as DriverBankDetails;
  } catch {
    /* ignore */
  }
  return loadDevBank();
}

function saveLocalBank(uid: string, details: DriverBankDetails) {
  saveDevBank(details);
  if (!uid) return;
  try {
    localStorage.setItem(`${LOCAL_BANK_PREFIX}${uid}`, JSON.stringify(details));
  } catch {
    /* ignore */
  }
}

function normalizeIban(raw: string): string {
  return String(raw || '').replace(/\s+/g, '').toUpperCase();
}

function isValidSaudiIban(iban: string): boolean {
  return /^SA\d{22}$/.test(normalizeIban(iban));
}

function parseBankDetails(raw: unknown): DriverBankDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const bank = raw as Record<string, unknown>;
  const bankName = String(bank.bankName || '').trim();
  const iban = normalizeIban(String(bank.iban || ''));
  if (bankName.length < 2 || !isValidSaudiIban(iban)) return null;
  const accountHolderName = String(bank.accountHolderName || '').trim();
  return {
    bankName,
    iban,
    ...(accountHolderName ? { accountHolderName } : {}),
  };
}

async function persistBankDetailsClient(
  details: DriverBankDetails
): Promise<DriverBankDetails> {
  let uid = currentDriverUid();
  try {
    await ensureFirebaseReady();
    uid = (await ensureSignedInFirebaseUid(5000)) || uid;
  } catch {
    /* local save still succeeds */
  }

  saveLocalBank(uid, details);

  if (!uid) return details;

  const stamp = {
    bankDetails: {
      ...details,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  try {
    const driverRef = doc(db, 'drivers', uid);
    const driverSnap = await getDoc(driverRef);
    if (driverSnap.exists()) {
      await setDoc(driverRef, stamp, { merge: true });
    }
  } catch (error) {
    console.warn('[payouts] Firestore drivers/{uid} bank write failed — kept locally', error);
  }

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await setDoc(userRef, stamp, { merge: true });
    }
  } catch (error) {
    console.warn('[payouts] Firestore users/{uid} bank write failed — kept locally', error);
  }

  return details;
}

async function loadBankDetailsClient(uid: string): Promise<DriverBankDetails | null> {
  const local = loadLocalBank(uid);
  if (!uid) return local;
  try {
    await ensureFirebaseReady();
    const snap = await getDoc(doc(db, 'drivers', uid));
    if (snap.exists()) {
      const parsed = parseBankDetails(
        (snap.data() as { bankDetails?: unknown }).bankDetails
      );
      if (parsed) {
        saveLocalBank(uid, parsed);
        return parsed;
      }
    }
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const parsed = parseBankDetails(
        (userSnap.data() as { bankDetails?: unknown }).bankDetails
      );
      if (parsed) {
        saveLocalBank(uid, parsed);
        return parsed;
      }
    }
  } catch (error) {
    console.warn('[payouts] Firestore bank-details read failed — using local cache', error);
  }
  return local;
}

async function createLocalWithdrawal(params: {
  amount: number;
  bankName?: string;
  iban?: string;
  accountHolderName?: string;
}): Promise<WithdrawalRequest> {
  let uid = currentDriverUid();
  try {
    await ensureFirebaseReady();
    uid = (await ensureSignedInFirebaseUid(5000)) || uid;
  } catch {
    /* continue with current uid */
  }

  const bank = loadLocalBank(uid);
  const bankName = (params.bankName || bank?.bankName || '').trim();
  const iban = normalizeIban(params.iban || bank?.iban || '');
  if (!bankName || !isValidSaudiIban(iban)) {
    throw new Error('Please save valid bank details before withdrawing');
  }
  if (!Number.isFinite(params.amount) || params.amount < 10) {
    throw new Error('Minimum withdrawal is 10 SAR');
  }

  const amount = roundMoney(params.amount);
  const wallet = uid ? loadLocalDriverWallet(uid) : { balance: amount };
  if (uid && amount > wallet.balance) {
    throw new Error('Insufficient wallet balance');
  }

  const before = uid ? wallet.balance : amount;
  if (uid) {
    applyLocalWalletHold(uid, amount);
  }

  const now = new Date().toISOString();
  const row: WithdrawalRequest = {
    id: `local-wd-${Date.now()}`,
    driverId: uid || 'local-driver',
    driverName: auth.currentUser?.displayName || 'Driver',
    driverPhone: auth.currentUser?.phoneNumber || '',
    amount,
    currency: 'SAR',
    status: 'pending',
    bankName,
    iban,
    accountHolderName: params.accountHolderName || bank?.accountHolderName || '',
    walletBalanceBefore: before,
    walletBalanceAfter: roundMoney(Math.max(0, before - amount)),
    createdAt: now,
    updatedAt: now,
    processedAt: null,
    processedBy: null,
    rejectionReason: null,
  };
  const all = loadLocalWithdrawals();
  all.unshift(row);
  saveLocalWithdrawals(all);
  saveDevWithdrawals(all);
  return row;
}

function patchLocalWithdrawal(
  withdrawalId: string,
  patch: Partial<WithdrawalRequest>
): WithdrawalRequest {
  const all = loadLocalWithdrawals();
  const idx = all.findIndex((w) => w.id === withdrawalId);
  if (idx < 0) throw new Error('Withdrawal not found');
  if (all[idx].status !== 'pending') throw new Error(`Already ${all[idx].status}`);
  all[idx] = {
    ...all[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveLocalWithdrawals(all);
  saveDevWithdrawals(all);
  return all[idx];
}

/** Driver: load saved bank / IBAN details. */
export async function fetchDriverBankDetails(): Promise<DriverBankDetails | null> {
  let uid = currentDriverUid();
  try {
    await ensureFirebaseReady();
    uid = (await ensureSignedInFirebaseUid(5000)) || uid;
  } catch {
    /* continue with whatever uid we have */
  }

  if (skipServerPayoutMutation()) {
    return loadBankDetailsClient(uid);
  }

  try {
    const res = await authFetch('/api/driver/bank-details');
    if (res.ok) {
      const data = await readApiJson<{ bankDetails: DriverBankDetails | null }>(res);
      const uid = currentDriverUid();
      if (data.bankDetails && uid) saveLocalBank(uid, data.bankDetails);
      return data.bankDetails;
    }
    const err = await readApiErrorMessage(res, 'Failed to load bank details');
    if (isClientPayoutFallback(res.status, err)) {
      return loadBankDetailsClient(currentDriverUid());
    }
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isClientPayoutFallback(500, text)) {
      return loadBankDetailsClient(currentDriverUid());
    }
    throw error;
  }
}

/** Driver: save bank / IBAN for payouts. */
export async function saveDriverBankDetailsApi(
  details: DriverBankDetails
): Promise<DriverBankDetails> {
  const bankName = details.bankName.trim();
  const iban = normalizeIban(details.iban);
  if (bankName.length < 2) throw new Error('Bank name is required');
  if (!isValidSaudiIban(iban)) {
    throw new Error('Invalid Saudi IBAN (expected SA + 22 digits)');
  }
  const saved: DriverBankDetails = {
    bankName,
    iban,
    ...(details.accountHolderName
      ? { accountHolderName: details.accountHolderName.trim() }
      : {}),
  };

  if (skipServerPayoutMutation()) {
    return persistBankDetailsClient(saved);
  }

  try {
    const res = await authFetch('/api/driver/bank-details', {
      method: 'PUT',
      body: JSON.stringify({
        bankName,
        iban,
        accountHolderName: details.accountHolderName,
      }),
    });
    if (res.ok) {
      const data = await readApiJson<{ bankDetails: DriverBankDetails }>(res);
      const uid = currentDriverUid();
      if (uid) saveLocalBank(uid, data.bankDetails);
      return data.bankDetails;
    }
    const err = await readApiErrorMessage(res, 'Failed to save bank details');
    if (isClientPayoutFallback(res.status, err)) {
      return persistBankDetailsClient(saved);
    }
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (
      isClientPayoutFallback(500, text) ||
      skipServerPayoutMutation() ||
      import.meta.env.DEV
    ) {
      return persistBankDetailsClient(saved);
    }
    throw error;
  }
}

/** Driver: create a withdrawal request (holds wallet balance until admin decision). */
export async function createDriverWithdrawal(params: {
  amount: number;
  bankName?: string;
  iban?: string;
  accountHolderName?: string;
}): Promise<WithdrawalRequest> {
  if (skipServerPayoutMutation()) {
    return createLocalWithdrawal(params);
  }

  try {
    const res = await authFetch('/api/driver/withdrawals', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await readApiJson<{ withdrawal: WithdrawalRequest }>(res);
      return data.withdrawal;
    }
    const err = await readApiErrorMessage(res, 'Failed to create withdrawal');
    if (isClientPayoutFallback(res.status, err)) {
      return createLocalWithdrawal(params);
    }
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (
      isClientPayoutFallback(500, text) ||
      skipServerPayoutMutation() ||
      import.meta.env.DEV
    ) {
      return createLocalWithdrawal(params);
    }
    throw error;
  }
}

/** Driver: own payout history. */
export async function fetchDriverWithdrawals(): Promise<WithdrawalRequest[]> {
  const uid = currentDriverUid();
  const local = loadLocalWithdrawals().filter((w) => !uid || w.driverId === uid);

  if (skipServerPayoutMutation()) {
    return local;
  }

  try {
    const res = await authFetch('/api/driver/withdrawals');
    if (res.ok) {
      const data = await readApiJson<{ withdrawals: WithdrawalRequest[] }>(res);
      const remote = data.withdrawals || [];
      const byId = new Map(remote.map((row) => [row.id, row]));
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
      return Array.from(byId.values());
    }
    const err = await readApiErrorMessage(res, 'Failed to load withdrawals');
    if (isClientPayoutFallback(res.status, err)) return local;
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isClientPayoutFallback(500, text)) return local;
    throw error;
  }
}

/** Admin: list all payout requests. */
export async function fetchAdminWithdrawals(
  status: WithdrawalStatus | 'all' = 'all'
): Promise<WithdrawalRequest[]> {
  const local = loadLocalWithdrawals();
  const filtered = status === 'all' ? local : local.filter((w) => w.status === status);

  if (skipServerPayoutMutation()) {
    return filtered;
  }

  try {
    const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    const res = await authFetch(`/api/admin/withdrawals${qs}`);
    if (res.ok) {
      const data = await readApiJson<{ withdrawals: WithdrawalRequest[] }>(res);
      return data.withdrawals;
    }
    const err = await readApiErrorMessage(res, 'Failed to load withdrawals');
    if (isClientPayoutFallback(res.status, err)) return filtered;
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isClientPayoutFallback(500, text)) return filtered;
    throw error;
  }
}

/** Admin: mark as transferred (تم التحويل). */
export async function approveAdminWithdrawal(
  withdrawalId: string
): Promise<WithdrawalRequest> {
  if (skipServerPayoutMutation()) {
    return patchLocalWithdrawal(withdrawalId, {
      status: 'paid',
      processedAt: new Date().toISOString(),
      processedBy: 'local-admin',
    });
  }
  try {
    const res = await authFetch(`/api/admin/withdrawals/${withdrawalId}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await readApiJson<{ withdrawal: WithdrawalRequest }>(res);
      return data.withdrawal;
    }
    const err = await readApiErrorMessage(res, 'Failed to approve withdrawal');
    if (isClientPayoutFallback(res.status, err)) {
      return patchLocalWithdrawal(withdrawalId, {
        status: 'paid',
        processedAt: new Date().toISOString(),
        processedBy: 'local-admin',
      });
    }
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isClientPayoutFallback(500, text)) {
      return patchLocalWithdrawal(withdrawalId, {
        status: 'paid',
        processedAt: new Date().toISOString(),
        processedBy: 'local-admin',
      });
    }
    throw error;
  }
}

function rejectLocalWithdrawal(
  withdrawalId: string,
  reason?: string
): WithdrawalRequest {
  const row = patchLocalWithdrawal(withdrawalId, {
    status: 'rejected',
    processedAt: new Date().toISOString(),
    processedBy: 'local-admin',
    rejectionReason: reason || 'Rejected by admin',
  });
  if (row.driverId && row.amount > 0) {
    releaseLocalWalletHold(row.driverId, row.amount);
  }
  return row;
}

/** Admin: reject and refund held balance. */
export async function rejectAdminWithdrawal(
  withdrawalId: string,
  reason?: string
): Promise<WithdrawalRequest> {
  if (skipServerPayoutMutation()) {
    return rejectLocalWithdrawal(withdrawalId, reason);
  }
  try {
    const res = await authFetch(`/api/admin/withdrawals/${withdrawalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      const data = await readApiJson<{ withdrawal: WithdrawalRequest }>(res);
      return data.withdrawal;
    }
    const err = await readApiErrorMessage(res, 'Failed to reject withdrawal');
    if (isClientPayoutFallback(res.status, err)) {
      return rejectLocalWithdrawal(withdrawalId, reason);
    }
    throw new Error(err);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isClientPayoutFallback(500, text)) {
      return rejectLocalWithdrawal(withdrawalId, reason);
    }
    throw error;
  }
}

export function formatIbanDisplay(iban: string): string {
  const n = normalizeIban(iban);
  return n.replace(/(.{4})/g, '$1 ').trim();
}
