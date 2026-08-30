// @ts-nocheck
/**
 * Worker 2 — Firebase & Backend Agent (Node-only).
 * Reads Firestore via Admin SDK. Writes are proposed only and wait for HITL OK.
 */
import admin from 'firebase-admin';
import { canUseAdminFirestore } from '../../server/lib/firebaseAdmin.ts';

const ALLOWED_COLLECTIONS = new Set([
  'orders',
  'users',
  'drivers',
  'withdrawals',
  'wallets',
  'pricing',
  'payments',
  'checkout_drafts',
]);

const WRITABLE_COLLECTIONS = new Set(['pricing']);

function requireAdminDb() {
  if (!canUseAdminFirestore()) {
    throw new Error('Firebase Admin credentials are not available on this host');
  }
  return admin.firestore();
}

function parseCommand(task) {
  const text = String(task || '');
  const getMatch = text.match(/\bget\s+([a-z_]+)\/([A-Za-z0-9_-]+)/i);
  if (getMatch) {
    return { op: 'get', collection: getMatch[1].toLowerCase(), id: getMatch[2] };
  }
  const queryMatch = text.match(
    /\bquery\s+([a-z_]+)(?:\s+limit=(\d+))?(?:\s+status=(\w+))?/i
  );
  if (queryMatch) {
    return {
      op: 'query',
      collection: queryMatch[1].toLowerCase(),
      limit: Math.min(Number(queryMatch[2]) || 10, 25),
      status: queryMatch[3] || '',
    };
  }
  const setMatch = text.match(
    /\bset\s+([a-z_]+)\/([A-Za-z0-9_-]+)\s+```json\s*([\s\S]*?)```/i
  );
  if (setMatch) {
    return {
      op: 'set',
      collection: setMatch[1].toLowerCase(),
      id: setMatch[2],
      data: JSON.parse(setMatch[3]),
    };
  }
  return { op: 'help' };
}

function sanitizeDoc(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (/iban|token|secret|password|private|apikey|api_key/.test(lower)) {
      const value = String(out[key] ?? '');
      out[key] = value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '[redacted]';
    }
  }
  return out;
}

/**
 * @param {{ task?: string }} state
 */
export async function runFirebaseAgent(state) {
  const command = parseCommand(state.task);

  if (command.op === 'help') {
    const report =
      'Firebase agent commands:\n' +
      '- get orders/{id}\n' +
      '- query withdrawals limit=10 status=pending\n' +
      '- set pricing/flatbed ```json { ... } ``` (requires email OK)';
    return {
      nextWorker: 'firebase',
      workerResults: { firebase: report },
      pendingAction: {
        worker: 'firebase',
        type: 'none',
        sensitive: false,
        summary: 'No Firebase mutation',
        payload: null,
      },
      finalResponse: report,
    };
  }

  if (!ALLOWED_COLLECTIONS.has(command.collection)) {
    throw new Error(`Collection "${command.collection}" is not allowed`);
  }

  const db = requireAdminDb();

  if (command.op === 'get') {
    const snap = await db.collection(command.collection).doc(command.id).get();
    const report = snap.exists
      ? `GET ${command.collection}/${command.id}\n${JSON.stringify(sanitizeDoc(snap.data()), null, 2)}`
      : `Missing ${command.collection}/${command.id}`;
    return {
      nextWorker: 'firebase',
      workerResults: { firebase: report },
      pendingAction: {
        worker: 'firebase',
        type: 'none',
        sensitive: false,
        summary: `Read ${command.collection}/${command.id}`,
        payload: null,
      },
      finalResponse: report,
    };
  }

  if (command.op === 'query') {
    let q = db.collection(command.collection).limit(command.limit);
    if (command.status && ['orders', 'withdrawals', 'payments'].includes(command.collection)) {
      q = db
        .collection(command.collection)
        .where('status', '==', command.status)
        .limit(command.limit);
    }
    const snap = await q.get();
    const rows = snap.docs.map((doc) => ({
      id: doc.id,
      ...sanitizeDoc(doc.data()),
    }));
    const report = `QUERY ${command.collection} (${rows.length})\n${JSON.stringify(rows, null, 2).slice(0, 3500)}`;
    return {
      nextWorker: 'firebase',
      workerResults: { firebase: report },
      pendingAction: {
        worker: 'firebase',
        type: 'none',
        sensitive: false,
        summary: `Queried ${command.collection}`,
        payload: null,
      },
      finalResponse: report,
    };
  }

  if (command.op === 'set') {
    if (!WRITABLE_COLLECTIONS.has(command.collection)) {
      throw new Error(`Writes to "${command.collection}" are not allowed`);
    }
    const summary = `Firebase set ${command.collection}/${command.id}`;
    return {
      nextWorker: 'firebase',
      workerResults: { firebase: summary },
      pendingAction: {
        worker: 'firebase',
        type: 'set_doc',
        sensitive: true,
        summary,
        payload: {
          collection: command.collection,
          id: command.id,
          data: command.data,
        },
      },
      finalResponse: `${summary}\n${JSON.stringify(command.data, null, 2)}`.slice(0, 2500),
    };
  }

  throw new Error('Unsupported Firebase command');
}

/**
 * @param {{ type?: string, payload?: { collection: string, id: string, data: object } }} action
 */
export async function executeFirebaseAction(action) {
  if (action?.type !== 'set_doc') {
    return { ok: true, skipped: true };
  }
  const { collection, id, data } = action.payload || {};
  if (!WRITABLE_COLLECTIONS.has(collection)) {
    throw new Error(`Writes to "${collection}" are not allowed`);
  }
  const db = requireAdminDb();
  await db
    .collection(collection)
    .doc(String(id))
    .set(
      {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'miras-supervisor',
      },
      { merge: true }
    );
  return { ok: true, path: `${collection}/${id}` };
}
