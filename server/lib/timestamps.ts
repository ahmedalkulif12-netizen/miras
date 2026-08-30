/** Firestore Timestamp / ISO / epoch helpers shared by admin reads. */

export function timestampToMs(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      /* fall through */
    }
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      /* fall through */
    }
  }
  if (typeof (value as { seconds?: number }).seconds === 'number') {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  return 0;
}

export function timestampToIso(value: unknown): string | null {
  const ms = timestampToMs(value);
  if (!ms) {
    if (typeof value === 'string' && value.trim()) return value;
    return null;
  }
  return new Date(ms).toISOString();
}
