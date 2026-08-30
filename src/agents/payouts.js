// @ts-nocheck
/**
 * Worker 4 — Driver Payouts Agent (Node-only).
 * Lists pending withdrawals and formats them for Supervisor HITL review.
 */
import admin from 'firebase-admin';
import {
  approveWithdrawal,
  listWithdrawalsForAdmin,
  rejectWithdrawal,
} from '../../server/lib/withdrawals.ts';
import { canUseAdminFirestore } from '../../server/lib/firebaseAdmin.ts';

function maskIban(iban) {
  const value = String(iban || '').replace(/\s+/g, '');
  if (value.length < 12) return value || '—';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function formatPayout(row) {
  return [
    `*Payout ${row.id}*`,
    `Status: ${row.status}`,
    `Driver: ${row.driverName || '—'} (${row.driverPhone || 'no phone'})`,
    `Amount: ${Number(row.amount || 0).toFixed(2)} ${row.currency || 'SAR'}`,
    `Bank: ${row.bankName || '—'}`,
    `IBAN: ${maskIban(row.iban)}`,
    `Holder: ${row.accountHolderName || '—'}`,
    `Wallet before/after hold: ${row.walletBalanceBefore} → ${row.walletBalanceAfter}`,
    `Created: ${row.createdAt || '—'}`,
  ].join('\n');
}

function parsePayoutTask(task) {
  const text = String(task || '');
  const approve = text.match(/\b(?:approve|pay|قبول|اعتماد)\s+([A-Za-z0-9_-]+)/i);
  if (approve) return { op: 'approve', id: approve[1] };
  const reject = text.match(/\b(?:reject|رفض)\s+([A-Za-z0-9_-]+)(?:\s+(.+))?/i);
  if (reject) return { op: 'reject', id: reject[1], reason: (reject[2] || '').trim() };
  const one = text.match(/\b(?:review|show|تفاصيل)\s+([A-Za-z0-9_-]+)/i);
  if (one) return { op: 'review', id: one[1] };
  return { op: 'list' };
}

/**
 * @param {{ task?: string }} state
 */
export async function runPayoutsAgent(state) {
  if (!canUseAdminFirestore()) {
    const report = 'Payouts agent: Firebase Admin is not configured, cannot read withdrawals.';
    return {
      nextWorker: 'payouts',
      workerResults: { payouts: report },
      pendingAction: {
        worker: 'payouts',
        type: 'none',
        sensitive: false,
        summary: report,
        payload: null,
      },
      finalResponse: report,
    };
  }

  const db = admin.firestore();
  const command = parsePayoutTask(state.task);
  const pending = await listWithdrawalsForAdmin(db, 'pending');

  if (command.op === 'list') {
    const report = pending.length
      ? `Pending payouts (${pending.length}):\n\n${pending.map(formatPayout).join('\n\n')}\n\nReply e.g. "approve ${pending[0].id}" or "reject ${pending[0].id} reason"`
      : 'No pending driver payouts.';
    return {
      nextWorker: 'payouts',
      workerResults: { payouts: report },
      pendingAction: {
        worker: 'payouts',
        type: 'none',
        sensitive: false,
        summary: 'Listed pending payouts',
        payload: null,
      },
      finalResponse: report,
    };
  }

  const row =
    pending.find((item) => item.id === command.id) ||
    (await listWithdrawalsForAdmin(db, 'all')).find((item) => item.id === command.id);

  if (!row) {
    const report = `Withdrawal ${command.id} was not found.`;
    return {
      nextWorker: 'payouts',
      workerResults: { payouts: report },
      pendingAction: {
        worker: 'payouts',
        type: 'none',
        sensitive: false,
        summary: report,
        payload: null,
      },
      finalResponse: report,
    };
  }

  if (command.op === 'review') {
    const report = `${formatPayout(row)}\n\nReply "approve ${row.id}" or "reject ${row.id} reason" after reviewing.`;
    return {
      nextWorker: 'payouts',
      workerResults: { payouts: report },
      pendingAction: {
        worker: 'payouts',
        type: 'none',
        sensitive: false,
        summary: `Reviewed ${row.id}`,
        payload: { id: row.id },
      },
      finalResponse: report,
    };
  }

  const isApprove = command.op === 'approve';
  const summary = isApprove
    ? `Pay withdrawal ${row.id} — ${Number(row.amount).toFixed(2)} SAR to ${row.driverName}`
    : `Reject withdrawal ${row.id} — ${command.reason || 'Rejected by admin'}`;

  return {
    nextWorker: 'payouts',
    workerResults: { payouts: formatPayout(row) },
    pendingAction: {
      worker: 'payouts',
      type: isApprove ? 'approve_payout' : 'reject_payout',
      sensitive: true,
      summary,
      payload: {
        id: row.id,
        reason: command.reason || '',
        formatted: formatPayout(row),
      },
    },
    finalResponse: `${summary}\n\n${formatPayout(row)}`,
  };
}

/**
 * @param {{ type?: string, payload?: { id: string, reason?: string } }} action
 */
export async function executePayoutsAction(action) {
  if (!action?.payload?.id) return { ok: true, skipped: true };
  if (!canUseAdminFirestore()) {
    throw new Error('Firebase Admin credentials are required to process payouts');
  }
  const db = admin.firestore();
  const actor = `email:${process.env.MIRAS_ADMIN_EMAIL || 'supervisor'}`;
  if (action.type === 'approve_payout') {
    const row = await approveWithdrawal(db, action.payload.id, actor);
    return { ok: true, status: row.status, id: row.id };
  }
  if (action.type === 'reject_payout') {
    const row = await rejectWithdrawal(
      db,
      action.payload.id,
      actor,
      action.payload.reason || 'Rejected via email supervisor'
    );
    return { ok: true, status: row.status, id: row.id };
  }
  return { ok: true, skipped: true };
}

/**
 * Watch new pending withdrawals after the initial snapshot.
 * @param {(task: string) => void | Promise<void>} onNewPending
 */
export function startPayoutWatcher(onNewPending) {
  if (!canUseAdminFirestore()) {
    console.warn('[payouts] watcher skipped — Admin Firestore unavailable');
    return () => {};
  }
  const db = admin.firestore();
  let primed = false;
  return db.collection('withdrawals').where('status', '==', 'pending').onSnapshot(
    (snap) => {
      if (!primed) {
        primed = true;
        if (snap.size > 0) {
          void onNewPending(
            `payouts list — ${snap.size} pending withdrawal(s) already in the queue`
          );
        }
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const id = change.doc.id;
        void onNewPending(`review ${id}`);
      }
    },
    (error) => {
      console.warn('[payouts] watcher error:', error?.message || error);
    }
  );
}
