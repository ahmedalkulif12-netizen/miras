/**
 * Target Firestore order shape (Phase A — types only).
 * Client writes may still use legacy fields until Phase B API migration.
 */

import type { TripFinancials } from './financials';
import type { OrderStatus, StatusHistoryEntry } from './order-status';

export interface GeoLocation {
  address: string;
  lat: number;
  lng: number;
  city?: string;
}

export interface OrderServiceDetails {
  subServiceType?: string;
  /** Resolved pricing tier key (e.g. small_truck, hydraulic, 1000L, light_equip). */
  type?: string;
  capacity?: string;
  /** Water tanker job type: fresh | normal | sewage. */
  waterType?: string;
  /** @deprecated Not used in fare math — distance is always geographic km. */
  tonnage?: string;
  truckCount?: number;
  goodsType?: string;
  furnitureDescription?: string;
  /** Tow / flatbed field notes for the assigned driver */
  vehicleFieldNotes?: VehicleFieldNotes;
  [key: string]: unknown;
}

/** Operational notes shown to tow-truck drivers on accept / navigate. */
export interface VehicleFieldNotes {
  keyInside?: boolean;
  tiresFlat?: boolean;
  brokenDown?: boolean;
  extraNotes?: string;
}

/**
 * Canonical order document (server-authoritative fields marked optional on client create).
 */
export interface FirestoreOrderDocument {
  userId: string;
  driverId?: string;
  serviceType: string;
  subServiceType?: string;
  serviceDetails?: OrderServiceDetails;
  /** Denormalized tow-truck field notes for admin / driver UIs */
  vehicleFieldNotes?: VehicleFieldNotes;
  pickup: GeoLocation;
  destination: GeoLocation;
  distanceKm: number;
  tripType: 'inside_city' | 'outside_city';
  financials: TripFinancials;
  /** @deprecated use financials.tripFare — kept for rules migration */
  totalPrice?: number;
  commission_amount?: number;
  driver_earning?: number;
  pricing_snapshot: Record<string, unknown>;
  status: OrderStatus;
  statusHistory?: StatusHistoryEntry[];
  paymentId?: string;
  paymentStatus?: 'pending' | 'authorized' | 'captured' | 'voided' | 'failed';
  moyasarId?: string;
  broadcastExpiresAt?: unknown;
  createdAt: unknown;
  updatedAt?: unknown;
}

/**
 * Builds rule-compatible flat pricing fields from financials (for future creates).
 */
export function financialsToFirestorePricingFields(financials: TripFinancials) {
  return {
    totalPrice: financials.customerTotal,
    tripFare: financials.tripFare,
    serviceFee: financials.serviceFee,
    commission_amount: financials.platformFee,
    driver_earning: financials.driverNet,
    financials,
  };
}

/**
 * Maps legacy client order payload toward canonical shape (non-destructive).
 */
export function normalizeLegacyOrderPayload(data: Record<string, unknown>): Record<string, unknown> {
  const tripFare =
    typeof data.tripFare === 'number'
      ? data.tripFare
      : typeof data.price === 'number'
        ? data.price
        : typeof data.totalPrice === 'number'
          ? data.totalPrice
          : undefined;

  return {
    ...data,
    ...(tripFare !== undefined && !data.financials
      ? {
          financials: {
            currency: 'SAR',
            feePolicyVersion: '2025-01',
            tripFare,
            serviceFee: 0,
            customerTotal: tripFare,
            platformFee: 0,
            driverNet: 0,
          },
        }
      : {}),
  };
}
