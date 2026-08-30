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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
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
    currency: financials.currency,
  };
}

/** Driver-safe offer lines (no percentages) */
export function toDriverOfferDisplay(financials: TripFinancials) {
  return {
    tripAmount: financials.tripFare,
    platformFee: financials.platformFee,
    netEarnings: financials.driverNet,
    currency: financials.currency,
  };
}
