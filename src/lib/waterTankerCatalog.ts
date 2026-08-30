/**
 * Water tanker service catalog: water quality type + tank capacity.
 * Capacity is a pricing tier label only — never treated as kilometers.
 */

export type WaterServiceType = 'fresh' | 'normal' | 'sewage';

export const WATER_SERVICE_TYPES: readonly WaterServiceType[] = [
  'fresh',
  'normal',
  'sewage',
] as const;

/** Capacities offered in the booking UI (liters). */
export const WATER_TANKER_CAPACITIES = [
  '1000L',
  '3000L',
  '5000L',
  '7000L',
  '10000L',
  '12000L',
] as const;

export type WaterTankerCapacity = (typeof WATER_TANKER_CAPACITIES)[number];

/** Price multipliers by water service type (applied on capacity base + per-km). */
export const WATER_TYPE_MULTIPLIERS: Record<WaterServiceType, number> = {
  fresh: 1.0, // مياه عذبة
  normal: 0.9, // مياه عادية / غير صالحة للشرب
  sewage: 1.25, // سحب مياه المجاري
};

export function isWaterServiceType(value: unknown): value is WaterServiceType {
  return value === 'fresh' || value === 'normal' || value === 'sewage';
}

export function normalizeWaterServiceType(
  raw: string | null | undefined
): WaterServiceType {
  if (!raw) return 'fresh';
  const key = String(raw).trim().toLowerCase();
  if (key === 'fresh' || key === 'potable' || key === 'عذبة') return 'fresh';
  if (
    key === 'normal' ||
    key === 'non_potable' ||
    key === 'non-potable' ||
    key === 'ordinary' ||
    key === 'عادية'
  ) {
    return 'normal';
  }
  if (
    key === 'sewage' ||
    key === 'waste' ||
    key === 'wastewater' ||
    key === 'مجاري' ||
    key === 'صرف'
  ) {
    return 'sewage';
  }
  return 'fresh';
}

export function waterTypeMultiplier(raw: string | null | undefined): number {
  return WATER_TYPE_MULTIPLIERS[normalizeWaterServiceType(raw)] ?? 1;
}

/** Liter integers that must never be treated as km in distance math. */
export const WATER_CAPACITY_LITER_VALUES: readonly number[] = [
  1000, 3000, 5000, 7000, 10000, 12000,
];

export function formatWaterOrderSummary(
  waterType: string | null | undefined,
  capacity: string | null | undefined,
  labels: { waterType: string; capacity: string }
): string {
  return `${labels.waterType} · ${labels.capacity}`;
}
