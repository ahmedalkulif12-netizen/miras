import type { Order } from '@/types';
import {
  normalizeTripFinancials,
  type TripFinancials,
} from '@/domain/financials';

export interface DriverOfferMetrics {
  pickupLabel: string;
  dropoffLabel: string;
  distanceKm: number;
  /** What the client pays (customerTotal = tripFare + service fee, possibly waived). */
  clientTotal: number;
  /** Trip fare before client service fee (basis for commission). */
  tripFare: number;
  /** Platform commission deducted from driver (15% of tripFare). */
  platformFee: number;
  /** Driver net payout after commission (tripFare − platformFee). */
  driverNet: number;
  /** Customer 5% service fee — 0 when the first-3-orders promo applies. */
  serviceFee: number;
  currency: string;
}

function addressFromUnknown(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && value !== null && 'address' in value) {
    return String((value as { address?: string }).address || '').trim();
  }
  return '';
}

/**
 * Extracts route + money metrics for the driver offer / active-trip card.
 * Prefers immutable `financials` snapshot; derives missing pieces from the
 * canonical money model (never mixes customer 5% fee with driver 15% commission).
 */
export function getDriverOfferMetrics(
  order: Order | null | undefined,
  fallbacks?: { clientTotal?: number; driverNet?: number }
): DriverOfferMetrics | null {
  if (!order) return null;

  const deliveryOnly =
    order.deliveryOnly === true ||
    order.locationMode === 'delivery_only' ||
    order.serviceType === 'water_tanker';

  const pickupLabel = deliveryOnly
    ? '—'
    : order.pickupAddress ||
      addressFromUnknown(order.pickup) ||
      order.pickupCity ||
      '—';
  const dropoffLabel =
    order.dropoffAddress ||
    addressFromUnknown(order.destination) ||
    order.dropoffCity ||
    '—';

  const distanceKm = Number(order.distanceKm ?? order.distance ?? 0);

  const legacy = order as Order & {
    totalPrice?: unknown;
    commission_amount?: unknown;
    driver_earning?: unknown;
    tripFare?: unknown;
    serviceFee?: unknown;
    platformFee?: unknown;
    driverNet?: unknown;
    customerTotal?: unknown;
    price?: unknown;
  };

  const financials = normalizeTripFinancials({
    financials: order.financials as TripFinancials | undefined,
    tripFare: legacy.tripFare,
    serviceFee: legacy.serviceFee,
    customerTotal: legacy.customerTotal,
    platformFee: legacy.platformFee,
    driverNet: legacy.driverNet,
    totalPrice: legacy.totalPrice,
    price: legacy.price,
    commission_amount: legacy.commission_amount,
    driver_earning: legacy.driver_earning,
  });

  let clientTotal = financials.customerTotal;
  let driverNet = financials.driverNet;
  if (clientTotal <= 0 && fallbacks?.clientTotal) clientTotal = fallbacks.clientTotal;
  if (driverNet <= 0 && fallbacks?.driverNet) driverNet = fallbacks.driverNet;

  return {
    pickupLabel,
    dropoffLabel,
    distanceKm: Math.max(0, Math.round(distanceKm * 10) / 10),
    clientTotal,
    tripFare: financials.tripFare,
    platformFee: financials.platformFee,
    driverNet,
    serviceFee: financials.serviceFee,
    currency: financials.currency || 'SAR',
  };
}
