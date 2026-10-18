/** Driver payout cadence. Admins store this on settings/payouts. */

export const DEFAULT_PAYOUT_INTERVAL_DAYS = 14;
export const MIN_PAYOUT_INTERVAL_DAYS = 1;
export const MAX_PAYOUT_INTERVAL_DAYS = 90;

export function normalizePayoutIntervalDays(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_PAYOUT_INTERVAL_DAYS;
  return Math.min(MAX_PAYOUT_INTERVAL_DAYS, Math.max(MIN_PAYOUT_INTERVAL_DAYS, n));
}

export function parsePayoutInstant(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  return null;
}

/** Next moment a new request is allowed. Null when there is no prior request. */
export function nextPayoutEligibleAt(
  lastRequestAt: unknown,
  intervalDays: number
): Date | null {
  const last = parsePayoutInstant(lastRequestAt);
  if (!last) return null;
  const next = new Date(last.getTime());
  next.setUTCDate(next.getUTCDate() + normalizePayoutIntervalDays(intervalDays));
  return next;
}

/** Date the driver must wait for, or null when a request is allowed now. */
export function payoutBlockedUntil(
  lastRequestAt: unknown,
  intervalDays: number,
  now: Date = new Date()
): Date | null {
  const next = nextPayoutEligibleAt(lastRequestAt, intervalDays);
  if (!next || next.getTime() <= now.getTime()) return null;
  return next;
}

export function formatPayoutDate(value: Date, isRtl: boolean): string {
  return value.toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatPayoutCooldownNotice(
  intervalDays: number,
  nextEligible: Date,
  isRtl: boolean
): string {
  const date = formatPayoutDate(nextEligible, isRtl);
  const days = normalizePayoutIntervalDays(intervalDays);
  if (!isRtl && days === 14) {
    return `Payout requests are permitted once every 2 weeks. Your next eligible withdrawal date is ${date}.`;
  }
  if (isRtl && days === 14) {
    return `يُسمح بطلبات السحب مرة كل أسبوعين. تاريخ السحب التالي المتاح هو ${date}.`;
  }
  if (isRtl) {
    return `يُسمح بطلبات السحب مرة كل ${days} يوماً. تاريخ السحب التالي المتاح هو ${date}.`;
  }
  return `Payout requests are permitted once every ${days} days. Your next eligible withdrawal date is ${date}.`;
}
