import type { Order } from '@/types';
import {
  buildTripFinancials,
  DRIVER_COMMISSION_RATE,
  type TripFinancials,
} from '@/domain/financials';

export interface DriverOfferMetrics {
  pickupLabel: string;
  dropoffLabel: string;
  distanceKm: number;
  /** What the client pays (customerTotal = tripFare + 5% service fee). */
  clientTotal: number;
  /** Trip fare before client service fee (basis for commission). */
  tripFare: number;
  /** Platform commission deducted from driver (15% of tripFare). */
  platformFee: number;
  /** Driver net payout after commission (tripFare − platformFee). */
  driverNet: number;
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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
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

  const financials = order.financials as TripFinancials | undefined;
  const legacy = order as Order & {
    totalPrice?: number;
    commission_amount?: number;
    driver_earning?: number;
    tripFare?: number;
    serviceFee?: number;
    price?: number | { total?: number };
  };

  let tripFare =
    Number(financials?.tripFare) || Number(legacy.tripFare) || 0;
  let platformFee =
    Number(financials?.platformFee) || Number(legacy.commission_amount) || 0;
  let driverNet =
    Number(financials?.driverNet) || Number(legacy.driver_earning) || 0;
  let clientTotal =
    Number(financials?.customerTotal) ||
    Number(legacy.totalPrice) ||
    (typeof legacy.price === 'number'
      ? legacy.price
      : Number(legacy.price?.total)) ||
    0;

  // Rebuild from tripFare when the snapshot is incomplete — single source of truth.
  if (tripFare > 0 && (platformFee <= 0 || driverNet <= 0 || clientTotal <= 0)) {
    const rebuilt = buildTripFinancials(tripFare, {
      waiveServiceFee: Number(financials?.serviceFee ?? legacy.serviceFee) === 0,
    });
    if (platformFee <= 0) platformFee = rebuilt.platformFee;
    if (driverNet <= 0) driverNet = rebuilt.driverNet;
    if (clientTotal <= 0) clientTotal = rebuilt.customerTotal;
  }

  // Derive tripFare from known net + commission (still commission-only math).
  if (tripFare <= 0 && driverNet > 0 && platformFee > 0) {
    tripFare = roundMoney(driverNet + platformFee);
  }
  if (tripFare <= 0 && clientTotal > 0) {
    // customerTotal = tripFare * 1.05 when service fee applies
    tripFare = roundMoney(clientTotal / (1 + 0.05));
  }
  if (platformFee <= 0 && tripFare > 0) {
    platformFee = roundMoney(tripFare * DRIVER_COMMISSION_RATE);
  }
  if (driverNet <= 0 && tripFare > 0) {
    driverNet = roundMoney(tripFare - platformFee);
  }
  if (clientTotal <= 0 && tripFare > 0) {
    clientTotal = roundMoney(tripFare + tripFare * 0.05);
  }

  // Last-resort empty-state fallbacks only (never overwrite real financials).
  if (clientTotal <= 0 && fallbacks?.clientTotal) clientTotal = fallbacks.clientTotal;
  if (driverNet <= 0 && fallbacks?.driverNet) driverNet = fallbacks.driverNet;

  // Invariant: driverNet + platformFee ≈ tripFare; clientTotal ≥ tripFare.
  if (tripFare > 0) {
    platformFee = roundMoney(tripFare * DRIVER_COMMISSION_RATE);
    driverNet = roundMoney(tripFare - platformFee);
  }

  return {
    pickupLabel,
    dropoffLabel,
    distanceKm: Math.max(0, Math.round(distanceKm * 10) / 10),
    clientTotal: roundMoney(clientTotal),
    tripFare: roundMoney(tripFare),
    platformFee: roundMoney(platformFee),
    driverNet: roundMoney(driverNet),
    currency: financials?.currency || 'SAR',
  };
}
