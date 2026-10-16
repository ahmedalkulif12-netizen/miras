/**
 * Tap appends the charge id to redirect.url. Hosted checkout sometimes glues
 * `tap_id` onto an existing query with a second `?`, so draftId and the charge
 * id have to be split back apart before verification.
 */
const CHARGE_KEYS = ['tap_id', 'tapChargeId', 'charge_id', 'chargeId', 'id'] as const;

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

export function readTapReturnParams(query: Record<string, unknown>): {
  draftId: string;
  orderId: string;
  chargeId: string;
  status: string;
} {
  let draftId = firstValue(query.draftId);
  const orderId = firstValue(query.orderId);
  const status = firstValue(query.status);
  let chargeId = '';
  for (const key of CHARGE_KEYS) {
    const value = firstValue(query[key]);
    if (!value) continue;
    if (key === 'id' && !/^chg_[A-Za-z0-9]+$/.test(value)) continue;
    chargeId = value;
    break;
  }

  const glued = draftId.match(/[?&](?:tap_id|tapChargeId|charge_id|chargeId)=([^&]+)/i);
  if (glued) {
    chargeId = chargeId || decodeURIComponent(glued[1]);
    draftId = draftId.replace(/[?&].*$/, '');
  }

  if (!chargeId) {
    const embedded = draftId.match(/chg_[A-Za-z0-9]+/);
    if (embedded && embedded[0] !== draftId) {
      chargeId = embedded[0];
      draftId = draftId.replace(embedded[0], '').replace(/[?&=]+$/g, '');
    }
  }

  return { draftId, orderId, chargeId, status };
}
