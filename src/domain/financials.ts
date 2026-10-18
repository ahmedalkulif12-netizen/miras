/**
 * Canonical money model for Miras (Phase A).
 * UI must use labeled amounts only — never expose rate constants to customers.
 *
 * Single source of truth (no overlapping meanings):
 * - tripFare      = base + extraKm (service tier)
 * - serviceFee    = 5% of tripFare (customer checkout line)
 * - customerTotal = tripFare + serviceFee
 * - platformFee   = driver commission % of tripFare (default 15%, loyalty can lower it)
 * - driverNet     = tripFare − platformFee
 *
 * Promo: the customer's service fee is waived for their first
 * FREE_SERVICE_FEE_ORDERS paid requests. Driver commission always applies.
 * Percentages come from Firestore `pricing/{service}` when a caller passes
 * them. These constants are the fallback when a document or field is missing.
 */

export const FEE_POLICY_VERSION = '2026-10' as const;
export const CUSTOMER_SERVICE_FEE_RATE = 0.05;
export const DRIVER_COMMISSION_RATE = 0.15;

/** Driver commission by completed orders. Editable on pricing/{service}.driver_commission_tiers. */
export interface DriverCommissionTier {
  min_completed_orders: number;
  commission_percentage: number;
}

export const DEFAULT_DRIVER_COMMISSION_TIERS: readonly DriverCommissionTier[] = [
  { min_completed_orders: 0, commission_percentage: 15 },
  { min_completed_orders: 150, commission_percentage: 12 },
  { min_completed_orders: 300, commission_percentage: 10 },
];
export const MIN_WITHDRAWAL_SAR = 10;
export const DEFAULT_CURRENCY = 'SAR' as const;
/** First N paid/created orders waive the 5% customer service fee. */
export const FREE_SERVICE_FEE_ORDERS = 3;

export function shouldWaiveServiceFee(previousPaidOrderCount: number): boolean {
  return previousPaidOrderCount < FREE_SERVICE_FEE_ORDERS;
}

export type CurrencyCode = typeof DEFAULT_CURRENCY;

/** Immutable snapshot stored on orders / payments */
export interface TripFinancials {
  currency: CurrencyCode;
  feePolicyVersion: string;
  tripFare: number;
  serviceFee: number;
  customerTotal: number;
  platformFee: number;
  driverNet: number;
  /** Percent of trip fare charged to the customer. Present on new snapshots. */
  customerServiceFeePercentage?: number;
  /** Percent of trip fare kept from the driver. Present on new snapshots. */
  driverCommissionPercentage?: number;
  /** Driver completed orders used to pick the commission band. */
  completedOrdersCount?: number;
}

export interface BuildFinancialsOptions {
  /** Legacy promo: first N orders with no service fee */
  waiveServiceFee?: boolean;
  /** 0–100. Falls back to 5 when omitted or invalid. */
  customerServiceFeePercentage?: number;
  /** 0–100. Falls back to 15 when omitted or invalid. */
  driverCommissionPercentage?: number;
}

function readConfiguredPercentage(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return Math.round(n * 1000) / 1000;
}

function optionalPercentage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** Customer fee percent from a pricing document. Missing or invalid values stay at 5. */
export function resolveCustomerServiceFeePercentage(
  source?: { customer_service_fee_percentage?: unknown } | null
): number {
  return readConfiguredPercentage(
    source?.customer_service_fee_percentage,
    CUSTOMER_SERVICE_FEE_RATE * 100
  );
}

/**
 * Loyalty schedule from Firestore, or the built-in 15 / 12 / 10 bands.
 * When `tiers` is empty, the 0-order band uses `basePercentage`.
 */
export function normalizeDriverCommissionTiers(
  tiers: unknown,
  basePercentage?: number
): DriverCommissionTier[] {
  const parsed: DriverCommissionTier[] = [];
  if (Array.isArray(tiers)) {
    for (const row of tiers) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const min = Number(record.min_completed_orders ?? record.minCompletedOrders);
      const pct = Number(record.commission_percentage ?? record.commissionPercentage);
      if (!Number.isFinite(min) || min < 0) continue;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
      parsed.push({
        min_completed_orders: Math.floor(min),
        commission_percentage: Math.round(pct * 1000) / 1000,
      });
    }
  }
  parsed.sort((a, b) => a.min_completed_orders - b.min_completed_orders);
  if (parsed.length > 0) return parsed;
  const base = readConfiguredPercentage(basePercentage, DRIVER_COMMISSION_RATE * 100);
  return DEFAULT_DRIVER_COMMISSION_TIERS.map((tier, index) =>
    index === 0 ? { ...tier, commission_percentage: base } : { ...tier }
  );
}

/**
 * Driver commission percent.
 * A numeric profile percentage wins. Otherwise the highest loyalty tier
 * whose minimum completed orders is <= the driver's count.
 */
export function resolveDriverCommissionPercentage(input: {
  completedOrdersCount?: number;
  tiers?: unknown;
  basePercentage?: number;
  profilePercentage?: unknown;
}): number {
  const profile = input.profilePercentage;
  if (profile !== undefined && profile !== null && profile !== '') {
    const n = Number(profile);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n * 1000) / 1000;
  }
  const tiers = normalizeDriverCommissionTiers(input.tiers, input.basePercentage);
  const count = Math.max(0, Math.floor(Number(input.completedOrdersCount) || 0));
  let selected = tiers[0]?.commission_percentage ?? DRIVER_COMMISSION_RATE * 100;
  for (const tier of tiers) {
    if (count >= tier.min_completed_orders) selected = tier.commission_percentage;
  }
  return selected;
}

/** Highest completed-order counter found on a driver profile or wallet. */
export function readCompletedOrdersCount(
  ...sources: Array<Record<string, unknown> | null | undefined>
): number {
  let max = 0;
  for (const source of sources) {
    if (!source) continue;
    for (const key of ['completed_orders_count', 'completedOrderCount', 'completedOrdersCount']) {
      const n = Number(source[key]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return Math.floor(max);
}

/**
 * Explicit driver-profile commission. Null when the profile does not set one,
 * so loyalty tiers still apply.
 */
export function readDriverProfileCommissionPercentage(
  driver: Record<string, unknown> | null | undefined
): number | null {
  if (!driver) return null;
  for (const key of ['platform_commission_percentage', 'commission_percentage']) {
    if (driver[key] === undefined || driver[key] === null || driver[key] === '') continue;
    const n = Number(driver[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n * 1000) / 1000;
  }
  return null;
}

/** Loose money fields found on orders, drafts, and legacy payloads. */
export interface OrderMoneySource {
  financials?: Partial<TripFinancials> | Record<string, unknown> | null;
  tripFare?: unknown;
  serviceFee?: unknown;
  customerTotal?: unknown;
  platformFee?: unknown;
  driverNet?: unknown;
  totalPrice?: unknown;
  price?: unknown;
  commission_amount?: unknown;
  driver_earning?: unknown;
}

export function roundMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Coerce Firestore / legacy price shapes (`300`, `"300"`, `{ total: 300 }`) to SAR. */
export function coerceMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return roundMoney(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) return roundMoney(n);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.total != null) return coerceMoney(obj.total);
    if (obj.amount != null) return coerceMoney(obj.amount);
    if (obj.customerTotal != null) return coerceMoney(obj.customerTotal);
  }
  return 0;
}

function hasOwnMoneyField(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function asPartialFinancials(
  value: OrderMoneySource['financials']
): Partial<TripFinancials> {
  if (!value || typeof value !== 'object') return {};
  return value as Partial<TripFinancials>;
}

/**
 * Builds trip financials from trip fare (subtotal before customer service fee).
 */
export function buildTripFinancials(
  tripFare: number,
  options: BuildFinancialsOptions = {}
): TripFinancials {
  const normalizedTripFare = roundMoney(Math.max(0, tripFare));
  const customerPct = readConfiguredPercentage(
    options.customerServiceFeePercentage,
    CUSTOMER_SERVICE_FEE_RATE * 100
  );
  const driverPct = readConfiguredPercentage(
    options.driverCommissionPercentage,
    DRIVER_COMMISSION_RATE * 100
  );
  const serviceFee = options.waiveServiceFee
    ? 0
    : roundMoney(normalizedTripFare * (customerPct / 100));
  const customerTotal = roundMoney(normalizedTripFare + serviceFee);
  const platformFee = roundMoney(normalizedTripFare * (driverPct / 100));
  const driverNet = roundMoney(normalizedTripFare - platformFee);

  return {
    currency: DEFAULT_CURRENCY,
    feePolicyVersion: FEE_POLICY_VERSION,
    tripFare: normalizedTripFare,
    serviceFee,
    customerTotal,
    platformFee,
    driverNet,
    customerServiceFeePercentage: customerPct,
    driverCommissionPercentage: driverPct,
  };
}

/**
 * Replace only the driver commission on an existing snapshot.
 * Customer total and service fee stay as already charged.
 */
export function financialsWithDriverCommission(
  source: OrderMoneySource,
  commissionPercentage: number,
  completedOrdersCount?: number
): TripFinancials {
  const current = normalizeTripFinancials(source);
  if (current.tripFare <= 0) return current;
  const driverPct = readConfiguredPercentage(
    commissionPercentage,
    DRIVER_COMMISSION_RATE * 100
  );
  const platformFee = roundMoney(current.tripFare * (driverPct / 100));
  const driverNet = roundMoney(current.tripFare - platformFee);
  return {
    ...current,
    platformFee,
    driverNet,
    driverCommissionPercentage: driverPct,
    ...(completedOrdersCount != null && Number.isFinite(completedOrdersCount)
      ? { completedOrdersCount: Math.max(0, Math.floor(completedOrdersCount)) }
      : {}),
  };
}

/**
 * Reconstruct a complete TripFinancials snapshot from whatever the order stored.
 * Never treats customerTotal as tripFare when the 5% service fee applied, and
 * never divides by 1.05 when the service fee was waived (customerTotal === tripFare).
 * Stored platformFee is kept when the snapshot balances. Otherwise driver
 * commission falls back to the stored percentage, then 15%.
 */
export function normalizeTripFinancials(source: OrderMoneySource): TripFinancials {
  const f = asPartialFinancials(source.financials);

  let tripFare = coerceMoney(f.tripFare ?? source.tripFare);
  let serviceFee = coerceMoney(f.serviceFee ?? source.serviceFee);
  let customerTotal = coerceMoney(
    f.customerTotal ?? source.customerTotal ?? source.totalPrice ?? source.price
  );
  let platformFee = coerceMoney(
    f.platformFee ?? source.platformFee ?? source.commission_amount
  );
  let driverNet = coerceMoney(f.driverNet ?? source.driverNet ?? source.driver_earning);

  const hasServiceFeeField =
    hasOwnMoneyField(f.serviceFee) || hasOwnMoneyField(source.serviceFee);

  const waivedFromFeeField = hasServiceFeeField && serviceFee === 0;
  const waivedFromTotals =
    tripFare > 0 && customerTotal > 0 && Math.abs(customerTotal - tripFare) < 0.05;
  const waived = waivedFromFeeField || waivedFromTotals;

  if (tripFare <= 0 && driverNet > 0 && platformFee > 0) {
    tripFare = roundMoney(driverNet + platformFee);
  }
  const storedDriverPct = optionalPercentage(f.driverCommissionPercentage);
  const storedCustomerPct = optionalPercentage(f.customerServiceFeePercentage);
  if (tripFare <= 0 && platformFee > 0) {
    const divisor = (storedDriverPct ?? DRIVER_COMMISSION_RATE * 100) / 100;
    tripFare = roundMoney(platformFee / divisor);
  }
  if (tripFare <= 0 && customerTotal > 0) {
    const customerRate = (storedCustomerPct ?? CUSTOMER_SERVICE_FEE_RATE * 100) / 100;
    tripFare = waived
      ? customerTotal
      : hasServiceFeeField && serviceFee > 0
        ? roundMoney(customerTotal - serviceFee)
        : roundMoney(customerTotal / (1 + customerRate));
  }

  const impliedCustomerPct =
    storedCustomerPct ??
    (!waived && tripFare > 0 && serviceFee > 0 ? (serviceFee / tripFare) * 100 : undefined);
  const impliedDriverPct =
    storedDriverPct ??
    (tripFare > 0 && platformFee > 0 ? (platformFee / tripFare) * 100 : undefined);

  const rebuilt = buildTripFinancials(tripFare, {
    waiveServiceFee: waived,
    ...(impliedCustomerPct != null ? { customerServiceFeePercentage: impliedCustomerPct } : {}),
    ...(impliedDriverPct != null ? { driverCommissionPercentage: impliedDriverPct } : {}),
  });

  const snapshotConsistent =
    tripFare > 0 &&
    platformFee > 0 &&
    driverNet > 0 &&
    customerTotal > 0 &&
    Math.abs(driverNet + platformFee - tripFare) < 0.05 &&
    Math.abs(tripFare + serviceFee - customerTotal) < 0.05;

  if (snapshotConsistent) {
    return {
      currency: (f.currency as CurrencyCode) || DEFAULT_CURRENCY,
      feePolicyVersion: String(f.feePolicyVersion || FEE_POLICY_VERSION),
      tripFare,
      serviceFee,
      customerTotal,
      platformFee,
      driverNet,
      ...(storedCustomerPct != null ? { customerServiceFeePercentage: storedCustomerPct } : {}),
      ...(storedDriverPct != null ? { driverCommissionPercentage: storedDriverPct } : {}),
      ...(Number.isFinite(Number(f.completedOrdersCount))
        ? { completedOrdersCount: Math.max(0, Math.floor(Number(f.completedOrdersCount))) }
        : {}),
    };
  }

  return {
    ...rebuilt,
    currency: (f.currency as CurrencyCode) || rebuilt.currency,
    feePolicyVersion: String(f.feePolicyVersion || rebuilt.feePolicyVersion),
  };
}

/** Flat fields written next to `financials` so client/driver queries stay in sync. */
export function toPersistedOrderMoneyFields(financials: TripFinancials): {
  financials: TripFinancials;
  totalPrice: number;
  price: number;
  tripFare: number;
  serviceFee: number;
  customerTotal: number;
  platformFee: number;
  driverNet: number;
  commission_amount: number;
  driver_earning: number;
  currency: CurrencyCode;
  feePolicyVersion: string;
} {
  const snapshot = normalizeTripFinancials({ financials });
  return {
    financials: snapshot,
    totalPrice: snapshot.customerTotal,
    price: snapshot.customerTotal,
    tripFare: snapshot.tripFare,
    serviceFee: snapshot.serviceFee,
    customerTotal: snapshot.customerTotal,
    platformFee: snapshot.platformFee,
    driverNet: snapshot.driverNet,
    commission_amount: snapshot.platformFee,
    driver_earning: snapshot.driverNet,
    currency: snapshot.currency,
    feePolicyVersion: snapshot.feePolicyVersion,
  };
}

/**
 * Maps canonical financials to legacy API fields used by existing UI.
 */
export function toLegacyPricingFields(financials: TripFinancials, extras: {
  isServiceFeeFree: boolean;
  tripType: 'inside_city' | 'outside_city';
  base: number;
  extraKm: number;
  rate: number;
  surgeApplied: boolean;
  isPriceCapApplied: boolean;
  pricingSnapshot: Record<string, unknown>;
}) {
  return {
    subtotal: financials.tripFare,
    total: financials.customerTotal,
    serviceFee: financials.serviceFee,
    commission_amount: financials.platformFee,
    driver_earning: financials.driverNet,
    financials,
    ...extras,
  };
}

/** Customer-safe quote lines — distance/total/service fee only. Never expose driver commission. */
export function toCustomerQuoteDisplay(financials: TripFinancials) {
  return {
    tripPrice: financials.tripFare,
    serviceFee: financials.serviceFee,
    total: financials.customerTotal,
    currency: financials.currency,
  };
}

/** Driver-safe offer lines (no percentages) */
export function toDriverOfferDisplay(financials: TripFinancials) {
  return {
    tripAmount: financials.tripFare,
    clientTotal: financials.customerTotal,
    platformFee: financials.platformFee,
    netEarnings: financials.driverNet,
    currency: financials.currency,
  };
}
