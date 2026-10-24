/**
 * Tap Destinations split.
 *
 * The platform merchant keeps the remainder of the charge. The destination
 * receives the driver's net from the order snapshot (85% of trip fare at the
 * default 15% commission; loyalty tiers can raise the driver share).
 * The customer service fee stays with the platform because it is not part of
 * driverNet.
 *
 * When an order has no financial snapshot, the split is a flat 15% / 85% of
 * the captured amount.
 */

import { DRIVER_COMMISSION_RATE, roundMoney } from '@/domain/financials';

export const PLATFORM_SPLIT_RATE = DRIVER_COMMISSION_RATE;
export const PAYEE_SPLIT_RATE = 1 - PLATFORM_SPLIT_RATE;

export interface TapSplitAmounts {
  currency: 'SAR';
  chargeAmount: number;
  /** Kept on the GZ / JZ Logistics Tap merchant (charge − destination). */
  platformAmount: number;
  /** Sent to the driver or company Tap destination. */
  payeeAmount: number;
  platformRate: number;
  payeeRate: number;
  source: 'financials' | 'fixed_15_85';
}

export interface TapSplitMoneySource {
  customerTotal?: unknown;
  driverNet?: unknown;
  tripFare?: unknown;
}

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney(n);
}

export function splitTapCharge(
  chargeAmount: number,
  financials?: TapSplitMoneySource | null
): TapSplitAmounts {
  const charge = roundMoney(Math.max(0, Number(chargeAmount) || 0));
  const driverNet = money(financials?.driverNet);
  const tripFare = money(financials?.tripFare);
  const useFinancials = tripFare > 0 && driverNet > 0;
  const rawPayee = useFinancials ? driverNet : roundMoney(charge * PAYEE_SPLIT_RATE);
  const payeeAmount = roundMoney(Math.min(charge, Math.max(0, rawPayee)));
  const platformAmount = roundMoney(Math.max(0, charge - payeeAmount));
  const payeeRate = charge > 0 ? roundMoney((payeeAmount / charge) * 100) / 100 : PAYEE_SPLIT_RATE;
  const platformRate = charge > 0 ? roundMoney((platformAmount / charge) * 100) / 100 : PLATFORM_SPLIT_RATE;
  return {
    currency: 'SAR',
    chargeAmount: charge,
    platformAmount,
    payeeAmount,
    platformRate,
    payeeRate,
    source: useFinancials ? 'financials' : 'fixed_15_85',
  };
}

/** Tap `destinations.destination[]` entry. Platform keeps charge − amount. */
export function tapDestinationEntry(
  destinationId: string,
  payeeAmount: number
): { id: string; amount: number; currency: 'SAR' } | null {
  const id = String(destinationId || '').trim();
  const amount = roundMoney(payeeAmount);
  if (!id || amount <= 0) return null;
  return { id, amount, currency: 'SAR' };
}
