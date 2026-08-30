#!/usr/bin/env tsx
/**
 * Inspect / delete development, E2E, and ghost records from Firestore.
 *
 * Default is dry-run (prints what would be deleted).
 *
 *   npx tsx scripts/cleanup-production-test-data.ts
 *   npx tsx scripts/cleanup-production-test-data.ts --execute
 *
 * Never deletes admins/{uid} or pricing docs. Never deletes the allowlisted admin phone.
 */
import { execSync } from 'node:child_process';
import {
  isDemoDocumentId,
  isProtectedAdminPhone,
  isTestOrGhostRecord,
} from '../server/lib/testDataPatterns.ts';

const EXECUTE = process.argv.includes('--execute');
const INSPECT = process.argv.includes('--inspect');
const PROJECT_ID = 'hamula-cfc6c';
const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;

const PROFILE_COLLECTIONS = [
  'users',
  'customers',
  'drivers',
  'corporates',
  'operators',
] as const;

const RELATED_COLLECTIONS = [
  'orders',
  'payments',
  'checkout_drafts',
  'wallets',
  'withdrawals',
  'driver_presence',
  'account_deletions',
  'subscriptions',
] as const;

interface FlaggedDoc {
  path: string;
  reason: string;
  name?: string;
  phone?: string;
  role?: string;
}

interface RestDoc {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

function gcloudAccessToken(): string {
  const token = execSync('gcloud auth print-access-token', {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!token || token.length < 20) {
    throw new Error('gcloud did not return credentials. Run: gcloud auth login');
  }
  return token;
}

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const map = v.mapValue as { fields?: Record<string, unknown> };
    return decodeFields(map.fields || {});
  }
  if ('arrayValue' in v) {
    const arr = v.arrayValue as { values?: unknown[] };
    return (arr.values || []).map(decodeValue);
  }
  return null;
}

function decodeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields || {})) {
    out[key] = decodeValue(val);
  }
  return out;
}

function docIdFromName(name: string): string {
  const parts = name.split('/documents/')[1] || name;
  return parts.split('/').pop() || name;
}

function relativePathFromName(name: string): string {
  return (name.split('/documents/')[1] || name).replace(/^\/+/, '');
}

async function firestoreJson(
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore REST ${method} ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return {};
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function listCollection(token: string, collectionPath: string, pageSize = 300): Promise<RestDoc[]> {
  const docs: RestDoc[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set('pageToken', pageToken);
    const payload = await firestoreJson(token, 'GET', `${BASE}/${collectionPath}?${qs.toString()}`);
    const rows = Array.isArray(payload.documents) ? payload.documents : [];
    for (const raw of rows) {
      const row = raw as { name?: string; fields?: Record<string, unknown> };
      if (!row.name) continue;
      docs.push({
        id: docIdFromName(row.name),
        path: relativePathFromName(row.name),
        data: decodeFields(row.fields || {}),
      });
    }
    pageToken = String(payload.nextPageToken || '');
  } while (pageToken);
  return docs;
}

function flagProfile(col: string, id: string, data: Record<string, unknown>): FlaggedDoc | null {
  if (isProtectedAdminPhone(data.phone)) return null;
  if (
    !isTestOrGhostRecord({
      uid: id,
      phone: data.phone,
      name: data.name || data.fullName || data.contactName,
      fullName: data.fullName,
      companyName: data.companyName,
      plateNumber: data.plateNumber,
    })
  ) {
    return null;
  }
  return {
    path: `${col}/${id}`,
    reason: 'test/ghost profile',
    name: String(data.name || data.fullName || data.contactName || ''),
    phone: String(data.phone || ''),
    role: String(data.role || ''),
  };
}

function isProtectedPath(path: string): boolean {
  return path.startsWith('admins/') || path.startsWith('pricing/');
}

async function collectFlags(token: string): Promise<FlaggedDoc[]> {
  const flagged: FlaggedDoc[] = [];
  const ghostUids = new Set<string>();

  for (const col of PROFILE_COLLECTIONS) {
    const docs = await listCollection(token, col);
    for (const doc of docs) {
      const hit = flagProfile(col, doc.id, doc.data);
      if (hit) {
        flagged.push(hit);
        ghostUids.add(doc.id);
      }
    }
  }

  for (const col of RELATED_COLLECTIONS) {
    const docs = await listCollection(token, col);
    for (const doc of docs) {
      const data = doc.data;
      const uid = String(data.uid || data.userId || data.driverId || doc.id);
      if (
        isDemoDocumentId(doc.id) ||
        isTestOrGhostRecord({
          uid: doc.id,
          userId: data.userId,
          driverId: data.driverId,
          phone: data.phone,
          name: data.name,
          localSharedE2E: data.localSharedE2E,
        }) ||
        ghostUids.has(uid) ||
        ghostUids.has(String(data.userId || '')) ||
        ghostUids.has(String(data.driverId || ''))
      ) {
        flagged.push({
          path: `${col}/${doc.id}`,
          reason: isDemoDocumentId(doc.id) ? 'demo/dev id' : 'linked to test profile',
        });
      }
    }
  }

  const operators = await listCollection(token, 'operators');
  for (const op of operators) {
    const vehicles = await listCollection(token, `operators/${op.id}/vehicles`);
    for (const vehicle of vehicles) {
      const data = vehicle.data;
      if (
        ghostUids.has(op.id) ||
        isTestOrGhostRecord({
          uid: vehicle.id,
          name: data.driverName,
          plateNumber: data.plateNumber,
          phone: data.phone,
        })
      ) {
        flagged.push({
          path: `operators/${op.id}/vehicles/${vehicle.id}`,
          reason: 'test fleet vehicle',
          name: String(data.driverName || ''),
        });
      }
    }
  }

  return flagged.filter((row) => !isProtectedPath(row.path));
}

async function deleteFlagged(token: string, flagged: FlaggedDoc[]): Promise<number> {
  let deleted = 0;
  const unique = [...new Map(flagged.map((row) => [row.path, row])).values()];
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    await firestoreJson(token, 'POST', `${BASE}:batchWrite`, {
      writes: chunk.map((row) => ({ delete: `${ROOT}/${row.path}` })),
    });
    deleted += chunk.length;
  }
  return deleted;
}

async function inspectProfiles(token: string): Promise<void> {
  console.log(`[inspect] project=${PROJECT_ID} remaining profiles`);
  for (const col of PROFILE_COLLECTIONS) {
    const docs = await listCollection(token, col);
    console.log(`[inspect] ${col}: ${docs.length}`);
    for (const doc of docs) {
      const name = String(doc.data.name || doc.data.fullName || doc.data.contactName || '');
      const phone = String(doc.data.phone || '');
      const role = String(doc.data.role || doc.data.accountStatus || '');
      console.log(`  - ${col}/${doc.id}  name=${name || '—'}  phone=${phone || '—'}  role=${role || '—'}`);
    }
  }
}

async function main() {
  const token = gcloudAccessToken();
  if (INSPECT) {
    await inspectProfiles(token);
    return;
  }
  console.log(`[cleanup] project=${PROJECT_ID} mode=${EXECUTE ? 'EXECUTE' : 'dry-run'}`);

  const flagged = await collectFlags(token);
  if (!flagged.length) {
    console.log('[cleanup] No test/ghost records found.');
    return;
  }

  console.log(`[cleanup] ${flagged.length} record(s) flagged:`);
  for (const row of flagged) {
    console.log(
      `  - ${row.path}${row.name ? `  name=${row.name}` : ''}${row.phone ? `  phone=${row.phone}` : ''}${row.role ? `  role=${row.role}` : ''}  (${row.reason})`
    );
  }

  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute to permanently delete these documents.');
    return;
  }

  const deleted = await deleteFlagged(token, flagged);
  console.log(`[cleanup] Deleted ${deleted} document(s).`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[cleanup] failed:', message);
  process.exit(1);
});
