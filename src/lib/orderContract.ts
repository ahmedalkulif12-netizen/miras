/**
 * Shared checkout / order payload types.
 * Kept out of orderService.ts so checkoutDraft and localOrderBridge can import
 * them without a circular module graph.
 */

export interface CreateOrderRequest {
  serviceType: string;
  truckType?: 'normal' | 'hydraulic' | 'box' | string;
  tripType?: 'inside_city' | 'outside_city';
  serviceDetails?: Record<string, unknown>;
  vehicleFieldNotes?: {
    keyInside?: boolean;
    tiresFlat?: boolean;
    brokenDown?: boolean;
    extraNotes?: string;
  };
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  /** Kilometers only — never tank liters. */
  distanceKm: number;
  pickupCity?: string;
  dropoffCity?: string;
  truckCount?: number;
  matchedDriverId?: string;
  /** Water tanker: customer only sets drop-off. */
  deliveryOnly?: boolean;
  locationMode?: 'pickup_destination' | 'delivery_only';
}

export interface CreateOrderResponse {
  orderId: string;
  financials: {
    tripFare: number;
    serviceFee: number;
    customerTotal: number;
    platformFee: number;
    driverNet: number;
    currency: string;
  };
  quote: Record<string, unknown>;
}
