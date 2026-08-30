/**
 * Transparent checkout totaling — no hidden multipliers or legacy double-counts.
 *
 * Displayed total MUST equal:
 *   basePrice + extraDistanceFee + serviceFee
 *
 * Naming (do not confuse with driver commission):
 * - serviceFee  = customer 5% fee on trip fare (checkout line)
 * - platformFee on TripFinancials = driver 15% commission (NOT shown as checkout line)
 */

export interface CheckoutLineItems {
  /** Base service price shown in the summary (e.g. 120). */
  basePrice: number;
  /** Extra distance fee shown in the summary (e.g. 0). */
  extraDistanceFee: number;
  /**
   * Customer service fee (5% of trip fare).
   * Prefer this over legacy `platformFee` checkout alias.
   */
  serviceFee?: number;
  /**
   * @deprecated Alias for customer serviceFee only — NOT driver commission.
   * Kept so existing call sites keep compiling.
   */
  platformFee?: number;
}

export interface CheckoutTotalBreakdown {
  basePrice: number;
  extraDistanceFee: number;
  /** Customer 5% service fee (same value exposed as platformFee for legacy UI). */
  serviceFee: number;
  /** @deprecated Same as serviceFee — customer fee, not driver commission. */
  platformFee: number;
  /** Exact sum of base + extra distance + customer service fee. */
  total: number;
}

function roundMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Clean checkout total — sums only the components shown in the UI summary.
 *
 * @example
 * calculateTotal({ basePrice: 120, extraDistanceFee: 0, serviceFee: 12.5 })
 * // → { basePrice: 120, extraDistanceFee: 0, serviceFee: 12.5, platformFee: 12.5, total: 132.5 }
 */
export function calculateTotal(parts: CheckoutLineItems): CheckoutTotalBreakdown {
  const basePrice = roundMoney(parts.basePrice);
  const extraDistanceFee = roundMoney(parts.extraDistanceFee);
  const serviceFee = roundMoney(
    parts.serviceFee ?? parts.platformFee ?? 0
  );
  const total = roundMoney(basePrice + extraDistanceFee + serviceFee);

  return {
    basePrice,
    extraDistanceFee,
    serviceFee,
    platformFee: serviceFee,
    total,
  };
}

/**
 * Build checkout lines from a quote response, then total with calculateTotal().
 * Ignores any mismatched customerTotal / tripFare from legacy engines.
 * Uses the same three components the UI will show — never invents a fourth term.
 * Never mixes driver commission (financials.platformFee) into the customer fee line.
 */
export function buildCheckoutFromQuote(quote: {
  base?: number;
  extraKm?: number;
  serviceFee?: number;
  isServiceFeeFree?: boolean;
  financials?: {
    serviceFee?: number;
    customerTotal?: number;
    tripFare?: number;
    /** Driver commission — must NOT be used as checkout service fee. */
    platformFee?: number;
  } | null;
}): CheckoutTotalBreakdown {
  const basePrice = roundMoney(quote.base);
  const extraDistanceFee = roundMoney(quote.extraKm);
  const tripSubtotal = roundMoney(basePrice + extraDistanceFee);

  const serviceFee = quote.isServiceFeeFree
    ? 0
    : roundMoney(
        quote.serviceFee ??
          quote.financials?.serviceFee ??
          tripSubtotal * 0.05
      );

  return calculateTotal({
    basePrice,
    extraDistanceFee,
    serviceFee,
  });
}
