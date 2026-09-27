/**
 * Firestore Admin rejects `undefined` (including nested keys like
 * quote.pricingSnapshot.capacity_prices). Strip those keys and coerce
 * known map/list fields so checkout drafts always persist.
 */

const MAP_KEYS = new Set(['capacity_prices', 'tier_prices', 'pricingSnapshot', 'quote']);
const LIST_KEYS = new Set(['statusHistory']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function coerceKnownField(key: string, value: unknown): unknown {
  if (value !== undefined && value !== null) return value;
  if (MAP_KEYS.has(key)) return {};
  if (LIST_KEYS.has(key)) return [];
  return null;
}

export function sanitizeForFirestore<T>(input: T): T {
  const walk = (value: unknown, key?: string): unknown => {
    if (value === undefined) {
      return key ? coerceKnownField(key, value) : undefined;
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }
    if (!isPlainObject(value)) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue === undefined) {
        if (MAP_KEYS.has(childKey)) {
          out[childKey] = {};
        } else if (LIST_KEYS.has(childKey)) {
          out[childKey] = [];
        }
        continue;
      }
      out[childKey] = walk(childValue, childKey);
    }
    return out;
  };

  return walk(input) as T;
}

/** Snapshot maps that must never be `undefined` on a Firestore quote. */
export function withDefinedPricingMaps(
  snapshot: Record<string, unknown>
): Record<string, unknown> {
  return sanitizeForFirestore({
    ...snapshot,
    capacity_prices:
      snapshot.capacity_prices && typeof snapshot.capacity_prices === 'object'
        ? snapshot.capacity_prices
        : {},
    tier_prices:
      snapshot.tier_prices && typeof snapshot.tier_prices === 'object'
        ? snapshot.tier_prices
        : {},
  });
}
