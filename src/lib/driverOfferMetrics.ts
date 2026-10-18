import type { Order } from '@/types';
import {
  financialsWithDriverCommission,
  normalizeTripFinancials,
  resolveDriverCommissionPercentage,
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

export interface DriverOfferCommissionContext {
  completedOrdersCount?: number;
  profilePercentage?: unknown;
  tiers?: unknown;
  basePercentage?: number;
}

/**
 * Extracts route + money metrics for the driver offer / active-trip card.
 * Prefers immutable `financials` snapshot; derives missing pieces from the
 * canonical money model (never mixes customer service fee with driver commission).
 * Open offers reprice net payout from the driver's loyalty band. Assigned
 * trips keep the snapshot written at accept.
 */
export function getDriverOfferMetrics(
  order: Order | null | undefined,
  fallbacks?: { clientTotal?: number; driverNet?: number },
  commission?: DriverOfferCommissionContext
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

  const assigned = Boolean(order.driverId);
  const priced =
    !assigned && commission
      ? financialsWithDriverCommission(
          {
            financials,
            tripFare: financials.tripFare,
            serviceFee: financials.serviceFee,
            customerTotal: financials.customerTotal,
            platformFee: financials.platformFee,
            driverNet: financials.driverNet,
          },
          resolveDriverCommissionPercentage({
            completedOrdersCount: commission.completedOrdersCount,
            tiers: commission.tiers,
            basePercentage: commission.basePercentage,
            profilePercentage: commission.profilePercentage,
          }),
          commission.completedOrdersCount
        )
      : financials;

  let clientTotal = priced.customerTotal;
  let driverNet = priced.driverNet;
  if (clientTotal <= 0 && fallbacks?.clientTotal) clientTotal = fallbacks.clientTotal;
  if (driverNet <= 0 && fallbacks?.driverNet) driverNet = fallbacks.driverNet;

  return {
    pickupLabel,
    dropoffLabel,
    distanceKm: Math.max(0, Math.round(distanceKm * 10) / 10),
    clientTotal,
    tripFare: priced.tripFare,
    platformFee: priced.platformFee,
    driverNet,
    serviceFee: priced.serviceFee,
    currency: priced.currency || 'SAR',
  };
}
