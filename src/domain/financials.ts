/**
 * Canonical money model for Miras (Phase A).
 * UI must use labeled amounts only — never expose rate constants to customers.
 *
 * Single source of truth (no overlapping meanings):
 * - tripFare      = base + extraKm (service tier)
 * - serviceFee    = 5% of tripFare (customer checkout line)
 * - customerTotal = tripFare + serviceFee
 * - platformFee   = 15% of tripFare (driver commission ONLY)
 * - driverNet     = tripFare − platformFee
 *
 * Promo: the customer's 5% service fee is waived for their first
 * FREE_SERVICE_FEE_ORDERS paid requests. Driver commission always applies.
 */

export const FEE_POLICY_VERSION = '2026-08' as const;
export const CUSTOMER_SERVICE_FEE_RATE = 0.05;
export const DRIVER_COMMISSION_RATE = 0.15;
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
}

export interface BuildFinancialsOptions {
  /** Legacy promo: first N orders with no service fee */
  waiveServiceFee?: boolean;
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
  const serviceFee = options.waiveServiceFee
    ? 0
    : roundMoney(normalizedTripFare * CUSTOMER_SERVICE_FEE_RATE);
  const customerTotal = roundMoney(normalizedTripFare + serviceFee);
  const platformFee = roundMoney(normalizedTripFare * DRIVER_COMMISSION_RATE);
  const driverNet = roundMoney(normalizedTripFare - platformFee);

  return {
    currency: DEFAULT_CURRENCY,
    feePolicyVersion: FEE_POLICY_VERSION,
    tripFare: normalizedTripFare,
    serviceFee,
    customerTotal,
    platformFee,
    driverNet,
  };
}

/**
 * Reconstruct a complete TripFinancials snapshot from whatever the order stored.
 * Never treats customerTotal as tripFare when the 5% service fee applied, and
 * never divides by 1.05 when the service fee was waived (customerTotal === tripFare).
 * Driver 15% commission is always derived from tripFare.
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
  if (tripFare <= 0 && platformFee > 0) {
    tripFare = roundMoney(platformFee / DRIVER_COMMISSION_RATE);
  }
  if (tripFare <= 0 && customerTotal > 0) {
    tripFare = waived
      ? customerTotal
      : hasServiceFeeField && serviceFee > 0
        ? roundMoney(customerTotal - serviceFee)
        : roundMoney(customerTotal / (1 + CUSTOMER_SERVICE_FEE_RATE));
  }

  const rebuilt = buildTripFinancials(tripFare, { waiveServiceFee: waived });

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

/** Customer-safe quote lines (no percentages) */
export function toCustomerQuoteDisplay(financials: TripFinancials) {
  return {
    tripPrice: financials.tripFare,
    serviceFee: financials.serviceFee,
    total: financials.customerTotal,
    platformFee: financials.platformFee,
    driverNet: financials.driverNet,
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
