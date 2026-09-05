/**
 * Remember paid order ids for the signed-in customer so My Orders can
 * listen to specific documents even when collection queries are denied.
 */

const KEY_PREFIX = 'miras_customer_order_ids_';
const MAX_IDS = 80;

function storageKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function rememberCustomerOrderId(uid: string, orderId: string): void {
  const owner = String(uid || '').trim();
  const id = String(orderId || '').trim();
  if (!owner || !id) return;
  try {
    const next = [id, ...loadRememberedCustomerOrderIds(owner).filter((item) => item !== id)];
    localStorage.setItem(storageKey(owner), JSON.stringify(next.slice(0, MAX_IDS)));
  } catch {
    /* ignore quota */
  }
}

export function loadRememberedCustomerOrderIds(uid: string): string[] {
  const owner = String(uid || '').trim();
  if (!owner) return [];
  try {
    const raw = localStorage.getItem(storageKey(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '')).filter(Boolean);
  } catch {
    return [];
  }
}
