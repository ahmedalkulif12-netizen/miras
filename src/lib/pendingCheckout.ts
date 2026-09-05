/**
 * Persist the unpaid checkout draft id across Moyasar redirects.
 * sessionStorage is lost when iOS/Android reopen the app via App Links;
 * localStorage survives the round-trip.
 */

const SESSION_KEY = 'pending_checkout_draft_id';
const LOCAL_KEY = 'miras_pending_checkout_draft_id';
const LEGACY_LOCAL_KEY = 'hamula_pending_checkout_draft_id';

export function persistPendingCheckoutDraftId(draftId: string): void {
  const id = String(draftId || '').trim();
  if (!id) return;
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LOCAL_KEY, id);
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

export function readPendingCheckoutDraftId(): string {
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) return session;
  } catch {
    /* ignore */
  }
  try {
    const local = localStorage.getItem(LOCAL_KEY) || localStorage.getItem(LEGACY_LOCAL_KEY);
    if (local) {
      persistPendingCheckoutDraftId(local);
      return local;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function clearPendingCheckoutDraftId(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('pending_order_id');
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
