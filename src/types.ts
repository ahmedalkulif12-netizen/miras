import type { OrderStatus as CanonicalOrderStatus } from '@/domain/order-status';

export type { CanonicalOrderStatus };
export { OrderStatus, normalizeOrderStatus, mapOrderStatusToTrackingUI, isOpenOfferStatus, isActiveTripStatus, isTerminalOrderStatus } from '@/domain/order-status';
export type { TripFinancials } from '@/domain/financials';

export type LogisticsServiceType = 
  | 'furniture_moving' // نقل عفش
  | 'flatbed' // نقل سطحه
  | 'water_tanker' // نقل صهاريج مياه
  | 'furniture_transport' // نقل أثاث
  | 'heavy_equipment' // نقل معدات ثقيلة
  | 'refrigerated' // نقل مبرد
  | 'goods_transport' // نقل بضائع

export interface ServiceDetail {
  label: string;
  value: string;
  options?: string[];
}

export type DriverAccountStatus =
  | 'approved'
  | 'pending'
  | 'ready_for_review'
  | 'rejected'
  | 'suspended'
  | 'banned';

export interface DriverComplaint {
  id: string;
  driverId: string;
  customerName: string;
  reason: string;
  date: string;
  isVerified: boolean;
}

export interface Order {
  id: string;
  userId: string;
  serviceType: LogisticsServiceType;
  /** Canonical vehicle category the order requires (same 6 types as `serviceType`). */
  requiredVehicleType?: LogisticsServiceType | string;
  truckType: 'normal' | 'hydraulic';
  tripType: 'inside_city' | 'outside_city';
  serviceDetails: {
    type?: string;
    capacity?: string;
    tonnage?: string;
    vehicleFieldNotes?: {
      keyInside?: boolean;
      tiresFlat?: boolean;
      brokenDown?: boolean;
      extraNotes?: string;
    };
    [key: string]: any;
  };
  vehicleFieldNotes?: {
    keyInside?: boolean;
    tiresFlat?: boolean;
    brokenDown?: boolean;
    extraNotes?: string;
  };
  pickup: string; // Keep for legacy
  pickupCity: string;
  pickupCoords?: { lat: number; lng: number };
  pickupAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  destination: string; // Keep for legacy
  dropoffCity: string;
  destinationCoords?: { lat: number; lng: number };
  dropoffAddress?: string;
  dropoffLat?: number;
  dropoffLng?: number;
  distance: number;
  distanceKm?: number;
  price: any; // Allow nested or flat for flexibility during transition
  /** Legacy UI values; prefer CanonicalOrderStatus + normalizeOrderStatus() */
  status: 'searching_driver' | 'on_the_way' | 'arrived' | 'completed' | CanonicalOrderStatus | string;
  financials?: import('@/domain/financials').TripFinancials;
  paymentStatus?: 'pending' | 'authorized' | 'captured' | 'failed';
  paymentId?: string;
  createdAt: string;
  driver?: {
    id?: string;
    name: string;
    phone: string;
    truckDetails: string;
    status: DriverAccountStatus;
    freezeUntil?: string;
    complaints?: DriverComplaint[];
  };
  /** Denormalized contact for trip parties (set on accept / publish). */
  driverPhone?: string;
  driverId?: string;
  customerPhone?: string;
  customerName?: string;
  /** Water tanker / delivery-only — customer sets drop-off only. */
  deliveryOnly?: boolean;
  locationMode?: 'pickup_destination' | 'delivery_only';
  matchedDriverId?: string;
}

// Note: Pricing is now fetched dynamically from Firebase Firestore
// Previously hardcoded constants have been removed.
