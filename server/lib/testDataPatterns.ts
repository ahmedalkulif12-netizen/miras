/**
 * Shared heuristics for development / E2E / mock Firestore records.
 * Used by production cleanup and the admin directory (so ghosts never reappear in the UI).
 */

const TEST_UID_PREFIXES = [
  'dev-bypass-',
  'dev-driver-',
  'dev-customer-',
  'e2e-',
  'demo-',
  'test-',
];

const TEST_COMPANIES = new Set(
  ['riyadh logistics corp', 'najd fleet operators'].map((s) => s.toLowerCase())
);

const AUTHORIZED_ADMIN_PHONES = new Set(['+966541330720', '966541330720', '0541330720']);

export function normalizePhoneDigits(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '');
}

export function isProtectedAdminPhone(phone: unknown): boolean {
  const digits = normalizePhoneDigits(phone);
  return AUTHORIZED_ADMIN_PHONES.has(digits) || AUTHORIZED_ADMIN_PHONES.has(`+${digits}`);
}

/** Firebase console / local mock Saudi test numbers (+9665000000xx). */
export function isTestPhone(phone: unknown): boolean {
  if (isProtectedAdminPhone(phone)) return false;
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  if (/^9665000000\d{1,3}$/.test(digits)) return true;
  if (/^5000000\d{1,3}$/.test(digits)) return true;
  return false;
}

export function isTestUid(uid: unknown): boolean {
  const id = String(uid || '');
  return TEST_UID_PREFIXES.some((prefix) => id.toLowerCase().startsWith(prefix));
}

export function isGeneratedStubName(name: unknown): boolean {
  return /^User_[a-zA-Z0-9]{3,8}$/.test(String(name || '').trim());
}

export function isTestName(name: unknown): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/^(e2e\s|dev\s|test\s|dummy\s)/i.test(n)) return true;
  return isGeneratedStubName(n);
}

export function isTestCompany(name: unknown): boolean {
  return TEST_COMPANIES.has(String(name || '').trim().toLowerCase());
}

/**
 * Synthetic demo/dev document ids.
 * Paid checkout often keeps a `draft-{timestamp}` id on the live `orders` doc —
 * that prefix is NOT a ghost marker.
 */
export function isDemoDocumentId(id: unknown): boolean {
  const value = String(id || '').toLowerCase();
  return (
    value.startsWith('demo-') ||
    value.startsWith('demo-trip-') ||
    value.startsWith('dev-')
  );
}

export interface TestRecordSignals {
  uid?: unknown;
  phone?: unknown;
  name?: unknown;
  fullName?: unknown;
  companyName?: unknown;
  plateNumber?: unknown;
  userId?: unknown;
  driverId?: unknown;
  localSharedE2E?: unknown;
}

export function isTestOrGhostRecord(signals: TestRecordSignals): boolean {
  if (isProtectedAdminPhone(signals.phone)) return false;
  if (isTestUid(signals.uid) || isTestUid(signals.userId) || isTestUid(signals.driverId)) {
    return true;
  }
  if (isTestPhone(signals.phone)) return true;
  if (isTestName(signals.name) || isTestName(signals.fullName)) return true;
  if (isTestCompany(signals.companyName)) return true;
  // localSharedE2E was historically set on all client order writes — only treat it
  // as a ghost when the uid already looks like a test record (handled above).
  const plate = String(signals.plateNumber || '').toUpperCase();
  if (plate.startsWith('E2E') || plate === 'ABC 4521' || plate === 'XYZ 9988') return true;
  return false;
}
