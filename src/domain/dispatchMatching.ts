/**
 * Progressive radius dispatch — nearby drivers first, then expand.
 * Never matches across distinct cities (e.g. Al-Hofuf/Al-Ahsa ↛ Dammam).
 */

export const DISPATCH_STAGES = [
  { stage: 1, radiusKm: 8, durationSec: 45 },
  { stage: 2, radiusKm: 20, durationSec: 45 },
  { stage: 3, radiusKm: 30, durationSec: 90 },
] as const;

export const DISPATCH_MAX_RADIUS_KM = 35;

export interface OrderDispatchMeta {
  startedAt: string;
  radiusKm: number;
  stage: number;
  maxRadiusKm: number;
  city: string;
  cityKey: string;
  pickupLat: number;
  pickupLng: number;
}

export interface DispatchWindow {
  stage: number;
  radiusKm: number;
  elapsedSec: number;
  expandsInSec: number;
  atMax: boolean;
}

const CITY_GROUPS: Record<string, string[]> = {
  ahsa: [
    'ahsa',
    'al ahsa',
    'al-ahsa',
    'alahsa',
    'hofuf',
    'al hofuf',
    'al-hofuf',
    'alhufuf',
    'al-hufuf',
    'الهفوف',
    'الأحساء',
    'الاحساء',
    'هفوف',
  ],
  dammam: ['dammam', 'ad dammam', 'الدمام'],
  khobar: ['khobar', 'al khobar', 'alkhobar', 'الخبر'],
  dhahran: ['dhahran', 'الظهران'],
  jubail: ['jubail', 'al jubail', 'الجبيل'],
  qatif: ['qatif', 'القطيف'],
  riyadh: ['riyadh', 'ar riyadh', 'الرياض'],
  jeddah: ['jeddah', 'jidda', 'جدة', 'جده'],
  makkah: ['makkah', 'mecca', 'مكة', 'مكه'],
  madinah: ['madinah', 'medina', 'المدينة'],
  taif: ['taif', 'الطائف'],
  abha: ['abha', 'أبها'],
  khamis: ['khamis mushait', 'خميس مشيط'],
  tabuk: ['tabuk', 'تبوك'],
  hail: ['hail', 'حائل'],
  buraidah: ['buraidah', 'بريدة'],
  yanbu: ['yanbu', 'ينبع'],
  najran: ['najran', 'نجران'],
  jazan: ['jazan', 'jizan', 'جازان'],
};

function foldCity(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[ـًٌٍَُِّْ]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeCityKey(raw: string | null | undefined): string {
  const folded = foldCity(raw || '');
  if (!folded) return '';
  for (const [key, aliases] of Object.entries(CITY_GROUPS)) {
    if (aliases.some((alias) => folded === alias || folded.includes(alias))) {
      return key;
    }
  }
  return folded.replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
}

export function sameDispatchCity(
  orderCity: string | null | undefined,
  driverCity: string | null | undefined
): boolean {
  const a = normalizeCityKey(orderCity);
  const b = normalizeCityKey(driverCity);
  if (!a || !b) return true;
  return a === b;
}

export function buildOrderDispatch(input: {
  pickupLat: number;
  pickupLng: number;
  pickupCity?: string;
  startedAt?: string;
}): OrderDispatchMeta {
  const startedAt = input.startedAt || new Date().toISOString();
  return {
    startedAt,
    radiusKm: DISPATCH_STAGES[0].radiusKm,
    stage: 1,
    maxRadiusKm: DISPATCH_MAX_RADIUS_KM,
    city: input.pickupCity || '',
    cityKey: normalizeCityKey(input.pickupCity || ''),
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
  };
}

function timestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch {
        /* ignore */
      }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  }
  return 0;
}

export function resolveDispatchWindow(
  startedAt: unknown,
  nowMs = Date.now()
): DispatchWindow {
  const start = timestampMs(startedAt) || nowMs;
  const elapsedSec = Math.max(0, (nowMs - start) / 1000);
  let consumed = 0;
  for (const stage of DISPATCH_STAGES) {
    consumed += stage.durationSec;
    if (elapsedSec < consumed) {
      return {
        stage: stage.stage,
        radiusKm: stage.radiusKm,
        elapsedSec,
        expandsInSec: Math.max(0, consumed - elapsedSec),
        atMax: false,
      };
    }
  }
  const last = DISPATCH_STAGES[DISPATCH_STAGES.length - 1];
  return {
    stage: last.stage,
    radiusKm: Math.min(last.radiusKm, DISPATCH_MAX_RADIUS_KM),
    elapsedSec,
    expandsInSec: 0,
    atMax: true,
  };
}

export function orderDispatchStartedAt(order: {
  dispatch?: { startedAt?: unknown };
  createdAt?: unknown;
  promotedAt?: unknown;
}): unknown {
  return order.dispatch?.startedAt || order.promotedAt || order.createdAt;
}

export function orderPickupPoint(order: {
  pickupLat?: number;
  pickupLng?: number;
  pickupCoords?: { lat?: number; lng?: number };
  pickup?: { lat?: number; lng?: number };
}): { lat: number; lng: number } | null {
  const lat = Number(
    order.pickupLat ?? order.pickupCoords?.lat ?? order.pickup?.lat
  );
  const lng = Number(
    order.pickupLng ?? order.pickupCoords?.lng ?? order.pickup?.lng
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function orderDispatchCity(order: {
  pickupCity?: string;
  dispatch?: { city?: string; cityKey?: string };
  pickup?: { city?: string };
}): string {
  return String(
    order.dispatch?.city ||
      order.dispatch?.cityKey ||
      order.pickupCity ||
      order.pickup?.city ||
      ''
  );
}
