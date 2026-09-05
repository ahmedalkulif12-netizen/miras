/**
 * Per-driver ignored open offers (تجاهل).
 * Ignored ids must not reappear on the active card until a new session list is rebuilt
 * without that id — they stay hidden for this driver.
 */

const STORAGE_PREFIX = 'miras.driver.ignoredOffers.v1.';
const MAX_IDS = 120;

function storageKey(driverUid: string): string {
  return `${STORAGE_PREFIX}${driverUid}`;
}

export function loadIgnoredDriverOfferIds(driverUid: string): string[] {
  const uid = String(driverUid || '').trim();
  if (!uid || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id || '').trim()).filter(Boolean).slice(0, MAX_IDS);
  } catch {
    return [];
  }
}

export function persistIgnoredDriverOffer(driverUid: string, orderId: string): string[] {
  const uid = String(driverUid || '').trim();
  const id = String(orderId || '').trim();
  if (!uid || !id) return loadIgnoredDriverOfferIds(uid);
  const next = [id, ...loadIgnoredDriverOfferIds(uid).filter((existing) => existing !== id)].slice(
    0,
    MAX_IDS
  );
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function isIgnoredDriverOffer(orderId: string, ignoredIds: Iterable<string>): boolean {
  const id = String(orderId || '').trim();
  if (!id) return false;
  for (const ignored of ignoredIds) {
    if (ignored === id) return true;
  }
  return false;
}

export function excludeIgnoredOffers<T extends { id: string }>(
  orders: T[],
  ignoredIds: Iterable<string>
): T[] {
  const blocked = new Set(Array.from(ignoredIds).map((id) => String(id)));
  return orders.filter((order) => !blocked.has(order.id));
}
